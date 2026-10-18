/**
 * One-command release for dsh-persona-forge.
 *
 *   node scripts/release.mjs            # asks which version bump
 *   node scripts/release.mjs patch      # patch | minor | major
 *   node scripts/release.mjs patch --dry-run
 *
 * What it does, in order, refusing at the first thing that is not right:
 *
 *   1. the tree is clean and on `main`
 *   2. the self-check suites pass
 *   3. the CHANGELOG's [Unreleased] section has content (this script never
 *      writes your release notes for you)
 *   4. bump package.json, promote [Unreleased] to a dated section, fix the
 *      link refs at the bottom
 *   5. one commit that carries the version AND the changelog entry together
 *   6. annotated tag, npm publish, push with --follow-tags
 *
 * The order matters. Tagging before the version bump (or publishing a commit
 * that the tag does not point at) is how v0.8.3 ended up with its tag on
 * 80b79a2 while npm shipped 4b61b4f.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const REPO_URL = 'https://github.com/sugarmaster666/dsh-persona-forge'
const BUMPS = ['patch', 'minor', 'major']

/**
 * Invoke npm without depending on how it is shimmed.
 *
 * On Windows npm is a `.cmd`, and neither `execFileSync('npm')` nor
 * `execFileSync('npm.cmd')` works: CreateProcess does not consult PATHEXT and
 * cannot execute a batch file directly. The portable route is to run npm's own
 * JavaScript entry through the Node binary already running this script, which
 * also removes any shell-quoting question from the arguments.
 */
function npmArgs(args) {
  const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (existsSync(npmCli)) return [npmCli, ...args]
  // Fall back to a shim on PATH (Linux/macOS, or a Node without a bundled npm).
  return [process.platform === 'win32' ? 'npm.cmd' : 'npm', ...args]
}

function run(command, args, options = {}) {
  const [file, argv] = command === 'npm' ? [process.execPath, npmArgs(args)] : [command, args]
  try {
    const output = execFileSync(file, argv, {
      cwd: root,
      encoding: 'utf8',
      stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    // With `stdio: 'inherit'` the child writes straight to this terminal and
    // execFileSync returns null, not a string.
    return output === null || output === undefined ? '' : output.trim()
  } catch (error) {
    const stderr = error.stderr?.toString().trim()
    const stdoutText = error.stdout?.toString().trim()
    const detail = [stdoutText, stderr].filter(Boolean).join('\n')
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`)
  }
}

/** Every refusal prints the same way and exits non-zero. */
function refuse(message, hint) {
  console.error(`\n✗ ${message}`)
  if (hint) console.error(`\n  ${hint.split('\n').join('\n  ')}`)
  console.error('\n没有做任何改动。\n')
  process.exit(1)
}

function step(message) {
  console.log(`\n▸ ${message}`)
}

function ok(message) {
  console.log(`  ✓ ${message}`)
}

/**
 * Is this exact version already on the registry?
 *
 * A 404 means "free", which is the normal answer before a release. Anything
 * else failing (no auth, offline) is reported as an error rather than silently
 * read as "free" — publishing on a wrong assumption is unrecoverable.
 */
function isPublished(version) {
  try {
    const found = run('npm', ['view', `dsh-persona-forge@${version}`, 'version'])
    return found !== ''
  } catch (error) {
    const message = error.message
    if (/E404|404 Not Found|is not in this registry/i.test(message)) return false
    throw new Error(
      `无法确认 ${version} 是否已发布到 npm（不是 404，是别的问题）：\n${message}\n\n` +
        '先修好 npm 的连通性或登录状态，再发布。',
    )
  }
}

/** Semver arithmetic, without pulling in a dependency the plugin cannot have. */
function bumpVersion(version, kind) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) throw new Error(`package.json version is not plain semver: ${version}`)
  let [, major, minor, patch] = match.map(Number)
  if (kind === 'major') {
    major += 1
    minor = 0
    patch = 0
  } else if (kind === 'minor') {
    minor += 1
    patch = 0
  } else {
    patch += 1
  }
  return `${major}.${minor}.${patch}`
}

/** Today in the project's own timezone, so a release at 00:30 is not dated yesterday. */
function today() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  return parts
}

// ---------------------------------------------------------------------------
// The CHANGELOG is the release notes, so this script edits it rather than
// generating it. Two jobs: promote [Unreleased] to a dated section, and keep
// the link refs at the bottom pointing at the right comparison.
// ---------------------------------------------------------------------------

/**
 * Split the changelog into its preamble, its [Unreleased] body, the remaining
 * sections, and the trailing link-ref block.
 */
function parseChangelog(text) {
  const lines = text.split('\n')
  const unreleasedAt = lines.findIndex((line) => line.trim() === '## [Unreleased]')
  if (unreleasedAt === -1) {
    refuse(
      'CHANGELOG.md 里找不到 `## [Unreleased]` 这一节。',
      '每一节新内容都要先写进 [Unreleased]，再由本脚本提成正式版本。',
    )
  }

  // The body runs until the next `## [` heading.
  let bodyEnd = lines.length
  for (let i = unreleasedAt + 1; i < lines.length; i += 1) {
    if (/^## \[/.test(lines[i])) {
      bodyEnd = i
      break
    }
  }

  const body = lines.slice(unreleasedAt + 1, bodyEnd)
  // Link refs live after the last `## [` section, as `[x]: url` lines.
  const refStart = lines.findIndex((line) => /^\[[^\]]+\]:\s+https?:/.test(line))
  const refs = refStart === -1 ? [] : lines.slice(refStart)

  return {
    head: lines.slice(0, unreleasedAt),
    body,
    after: refStart === -1 ? lines.slice(bodyEnd) : lines.slice(bodyEnd, refStart),
    refs,
  }
}

/** A body with no bullet lines is an empty section, which must not become a release. */
function bodyIsEmpty(body) {
  return !body.some((line) => /^\s*[-*]\s+\S/.test(line))
}

function buildChangelog(parsed, previousVersion, nextVersion) {
  const body = [...parsed.body]
  // Trim leading/trailing blank lines so the promoted section sits flush.
  while (body.length > 0 && body[0].trim() === '') body.shift()
  while (body.length > 0 && body[body.length - 1].trim() === '') body.pop()

  const section = [`## [${nextVersion}] - ${today()}`, '', ...body, '']

  // Rebuild the link refs: [Unreleased] compares from the new tag, and the new
  // tag gets its own compare link against the previous one.
  const refs = parsed.refs.filter((line) => !/^\[Unreleased\]:/.test(line) && !new RegExp(`^\\[${nextVersion.replace(/\./g, '\\.')}\\]:`).test(line))
  const newRefs = [
    `[Unreleased]: ${REPO_URL}/compare/v${nextVersion}...HEAD`,
    `[${nextVersion}]: ${REPO_URL}/compare/v${previousVersion}...v${nextVersion}`,
    ...refs,
  ]

  const lines = [
    ...parsed.head,
    '## [Unreleased]',
    '',
    ...section,
    ...parsed.after,
    ...newRefs,
  ]

  // Collapse runs of blank lines the assembly may have introduced.
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n*$/, '\n')
}

// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const force = args.includes('--force')
  const allowForeign = args.includes('--i-know-this-is-not-the-main-checkout')
  const requested = args.find((arg) => !arg.startsWith('-'))

  step('检查工作区')
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch !== 'main') {
    refuse(
      `当前在 \`${branch}\` 分支上，发布只在 \`main\` 上进行。`,
      'git switch main',
    )
  }

  // This script pushes to `origin` and publishes to the real registry. A
  // scratch copy of the repository (a test clone, a backup made with a
  // recursive copy) carries the SAME origin URL, so running the release there
  // pushes into the real project. Refuse unless the checkout is the one this
  // package declares, or the caller has said out loud that it is a drill.
  const origin = run('git', ['remote', 'get-url', 'origin'])
  const declared = `${REPO_URL}.git`
  const normalise = (url) => url.replace(/\.git$/, '').replace(/\/$/, '').toLowerCase()
  if (normalise(origin) !== normalise(declared) && !dryRun && !allowForeign) {
    refuse(
      `origin 指向 \`${origin}\`，不是本包的仓库 \`${declared}\`。`,
      '这通常意味着你在一个副本里运行（测试克隆、用资源管理器复制出来的备份）。\n' +
        '副本会继承真实的 origin，在这里发布会直接推到线上。\n\n' +
        '如果确实要在这个检出里发布，加 `--i-know-this-is-not-the-main-checkout`。',
    )
  }

  const dirty = run('git', ['status', '--porcelain'])
  if (dirty !== '') {
    refuse(
      '工作区不干净，有未提交的改动。',
      `${dirty}\n\n先提交或 stash，再发布——发布的那个 commit 必须能代表完整的代码。`,
    )
  }
  ok(`在 main 上，工作区干净`)

  step('跑自检')
  if (dryRun) {
    ok('（dry run：跳过）')
  } else {
    run('npm', ['run', 'check'], { inherit: true })
    ok('288 + 101 项检查通过')
  }

  step('读当前版本')
  const pkgPath = join(root, 'package.json')
  const pkgText = readFileSync(pkgPath, 'utf8')
  const pkg = JSON.parse(pkgText)
  const currentVersion = pkg.version
  const lastTag = run('git', ['describe', '--tags', '--abbrev=0'])
  ok(`package.json ${currentVersion}，最近的 tag ${lastTag}`)

  step('自上个 tag 以来的改动')
  const log = run('git', ['log', '--oneline', `${lastTag}..HEAD`])

  // The tag is already where package.json says it is, so the only question is
  // whether that release actually finished. Two states look identical from the
  // version number alone and need opposite answers:
  //
  //   - new commits since the tag, tag unpublished: the previous release died
  //     between `git tag` and `npm publish`. Offer to finish it.
  //   - no new commits, tag published: there is simply nothing to release.
  if (lastTag === `v${currentVersion}` && currentVersion !== '0.0.0') {
    const published = isPublished(currentVersion)
    if (log === '') {
      if (!published) {
        step(`发现未完成的发布：${lastTag} 已打 tag，但 npm 上没有 ${currentVersion}`)
        const rl = createInterface({ input: stdin, output: stdout })
        const answer = (
          await rl.question(`  只补做 publish 和 push（不会再改版本号）？[Y/n] `)
        ).trim().toLowerCase()
        rl.close()
        if (answer !== '' && answer !== 'y' && answer !== 'yes') {
          refuse(
            '你选择不继续。',
            `仓库停在 ${lastTag} 已打 tag、npm 未发布的状态。\n` +
              `要么重跑本脚本补完，要么手动 \`git tag -d ${lastTag}\` 撤销这次发布。`,
          )
        }
        await finishRelease(currentVersion, `v${currentVersion}`, run('git', ['rev-parse', 'HEAD']))
        return
      }
      refuse(
        `${lastTag} 已经发布过了，而且自那以后没有新提交。`,
        '没有改动就没有可发布的版本。',
      )
    }
    // New commits exist, so this is a normal release — but the previous tag
    // never reached npm, which the version numbering has now skipped over.
    if (!published) {
      refuse(
        `上一个 tag ${lastTag} 打了，但从没发布到 npm。`,
        `现在有新提交要发，但版本号还停在 ${currentVersion}。\n\n` +
          `先补完那个版本（\`npm run release\` 在无新提交时会认出它），\n` +
          `或者承认它没发过：\`git tag -d ${lastTag}\`，再重跑本脚本。`,
      )
    }
  }

  if (log === '') {
    refuse(`${lastTag} 之后没有任何提交。`, '没有改动就没有可发布的版本。')
  }

  if (lastTag !== `v${currentVersion}`) {
    refuse(
      `package.json 是 ${currentVersion}，但最近的 tag 是 ${lastTag}。`,
      '两者对不上，说明上一次发布没有走完。先手动对齐，再发布——\n否则新 tag 会指向一棵版本号和 tag 名不符的树。',
    )
  }
  console.log(
    log
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n'),
  )

  const hasFeat = /^\S+ feat[:(]/m.test(log)
  const hasFix = /^\S+ fix[:(]/m.test(log)
  const onlyDocs = !hasFeat && !hasFix

  step('选版本号')
  // The docs-only refusal is a property of the commits, not of how the bump was
  // requested: passing `patch` on the command line is an explicit version
  // choice, not permission to release a changelog tweak to every user.
  if (onlyDocs && !force) {
    refuse(
      `${lastTag} 以来只有文档或杂务改动，没有 feat 也没有 fix。`,
      '用户装插件不是为了看 README。等有真正能感知的变化再发。\n' +
        '确实要发（比如文档错了会误导人）就加 `--force`。',
    )
  }
  if (onlyDocs && force) {
    ok('只有文档改动，但 --force 已指定，继续')
  }

  let kind = requested
  if (kind === undefined) {
    const suggestion = hasFeat ? 'minor' : 'patch'
    const rl = createInterface({ input: stdin, output: stdout })
    console.log(`  改动里${hasFeat ? '有 feat（新功能）' : '只有 fix（修 bug）'}，建议 ${suggestion}`)
    console.log('  patch = 修 bug    minor = 加功能    major = 老用法会坏')
    const answer = (await rl.question(`  选哪个？[${suggestion}] `)).trim() || suggestion
    rl.close()
    kind = answer
  }

  if (!BUMPS.includes(kind)) {
    refuse(`\`${kind}\` 不是合法选项。`, `只能选 ${BUMPS.join(' / ')}。`)
  }

  const nextVersion = bumpVersion(currentVersion, kind)
  const nextTag = `v${nextVersion}`
  ok(`${currentVersion} → ${nextVersion}（${kind}）`)

  step('检查 tag 和 npm 上没有重名')
  const existingTags = run('git', ['tag', '--list', nextTag])
  if (existingTags !== '') {
    refuse(
      `tag ${nextTag} 已经存在。`,
      '已经发出去的版本号不能复用。换一个版本号，或者删掉本地那个没推上去的 tag。',
    )
  }
  if (isPublished(nextVersion)) {
    refuse(
      `npm 上已经有 dsh-persona-forge@${nextVersion}。`,
      'npm 的版本号永久存在，不能撤回重发。换一个更高的版本号。',
    )
  }
  ok(`tag ${nextTag} 和 npm 上的 ${nextVersion} 都空着`)

  step('检查 CHANGELOG')
  const changelogPath = join(root, 'CHANGELOG.md')
  const changelogText = readFileSync(changelogPath, 'utf8')
  const parsed = parseChangelog(changelogText)
  if (bodyIsEmpty(parsed.body)) {
    refuse(
      'CHANGELOG.md 的 [Unreleased] 是空的。',
      '发布说明由你写，本脚本只负责把它提成正式版本。\n\n' +
        '先在 `## [Unreleased]` 下面写好这一版改了什么（Added / Changed / Fixed），\n' +
        '写根因而不是症状，再跑一次。',
    )
  }
  ok('[Unreleased] 有内容')

  const nextChangelog = buildChangelog(parsed, currentVersion, nextVersion)
  const nextPkg = { ...pkg, version: nextVersion }
  const nextPkgText = `${JSON.stringify(nextPkg, undefined, 2)}\n`

  if (dryRun) {
    step('dry run：以下是将会发生的改动')
    console.log(`\n--- package.json ---\n${nextPkgText}`)
    console.log(`--- CHANGELOG.md（新版本节）---`)
    const sectionStart = nextChangelog.indexOf(`## [${nextVersion}]`)
    console.log(nextChangelog.slice(sectionStart, sectionStart + 600))
    console.log('\n（dry run：没有写文件，没有提交，没有发布）\n')
    return
  }

  step('写 package.json 和 CHANGELOG.md')
  writeFileSync(pkgPath, nextPkgText)
  writeFileSync(changelogPath, nextChangelog)
  ok(`版本号改成 ${nextVersion}，[Unreleased] 提成 [${nextVersion}]`)

  step('提交')
  run('git', ['add', 'package.json', 'CHANGELOG.md'])
  run('git', ['commit', '-m', `chore: release ${nextVersion} (${nextTag})`])
  const head = run('git', ['rev-parse', 'HEAD'])
  ok(`commit ${head.slice(0, 7)}`)

  step('打 tag')
  run('git', ['tag', '-a', nextTag, '-m', nextTag])
  const tagged = run('git', ['rev-parse', `${nextTag}^{commit}`])
  if (tagged !== head) {
    refuse(
      `tag ${nextTag} 指向 ${tagged.slice(0, 7)}，但 HEAD 是 ${head.slice(0, 7)}。`,
      '这是不应该发生的。手动检查 tag，不要发布。',
    )
  }
  ok(`${nextTag} → ${head.slice(0, 7)}`)

  await finishRelease(nextVersion, nextTag, head)
}

/**
 * Publish the tagged commit and verify the result.
 *
 * Split out from the version-bump path so an interrupted release can be
 * completed by re-running the script: the bump, the commit and the tag are
 * already done at that point, and only these steps remain.
 */
async function finishRelease(version, tag, head) {
  step('发布到 npm')
  try {
    run('npm', ['publish'], { inherit: true })
  } catch (error) {
    refuse(
      `npm publish 失败，${tag} 的 tag 已经打好，但没有任何东西被发布。`,
      `${error.message}\n\n` +
        '修好发布凭据（`npm login`，或检查 .npmrc 里的 registry 和 token）后，\n' +
        '重跑 `npm run release` —— 它会认出这个未完成的状态，只补做 publish 和 push。\n' +
        `如果要放弃这次发布：git tag -d ${tag} && git reset --hard HEAD~1`,
    )
  }
  ok(`dsh-persona-forge@${version} 已发布`)

  step('推送')
  // `--follow-tags` fails on a branch with no upstream, which is exactly the
  // state a fresh clone or a renamed branch is in — and by now npm already has
  // the package, so a failed push is the worst state to leave behind. Set the
  // upstream on the first push instead of failing into it.
  const hasUpstream = (() => {
    try {
      run('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
      return true
    } catch {
      return false
    }
  })()
  try {
    if (hasUpstream) {
      run('git', ['push', '--follow-tags'], { inherit: true })
    } else {
      const remote = run('git', ['remote'])
        .split('\n')
        .map((line) => line.trim())
        .find((name) => name === 'origin') ?? 'origin'
      run('git', ['push', '--set-upstream', remote, 'main', '--follow-tags'], { inherit: true })
    }
  } catch (error) {
    refuse(
      `推送失败。${version} 已经发到 npm，但 tag 和 commit 还在本地。`,
      `${error.message}\n\n` +
        '这是唯一一个"npm 上有了、GitHub 上还没有"的状态，尽快修好网络后：\n' +
        '  git push --follow-tags\n\n' +
        '如果是首次推送（分支还没有 upstream）：\n' +
        '  git push --set-upstream origin main --follow-tags',
    )
  }
  ok('代码和 tag 已推送')

  step('核对')
  const verifiedVersion = run('npm', ['view', 'dsh-persona-forge', 'version'])
  const verifiedHead = run('npm', ['view', 'dsh-persona-forge', 'gitHead'])
  if (verifiedVersion !== version) {
    refuse(
      `npm 上的 latest 是 ${verifiedVersion}，不是刚发布的 ${version}。`,
      '可能发到了别的 dist-tag 上。手动检查。',
    )
  }
  if (verifiedHead !== head) {
    refuse(
      `npm 记录的 gitHead 是 ${verifiedHead.slice(0, 7)}，但本地 HEAD 是 ${head.slice(0, 7)}。`,
      '发布的包和 tag 指向的树不一致。这就是 v0.8.3 出过的那个问题，不要忽略。',
    )
  }
  ok(`npm latest = ${verifiedVersion}，gitHead 与 HEAD 一致`)

  console.log(`\n✅ ${tag} 发布完成。\n`)
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}\n`)
  process.exit(1)
})
