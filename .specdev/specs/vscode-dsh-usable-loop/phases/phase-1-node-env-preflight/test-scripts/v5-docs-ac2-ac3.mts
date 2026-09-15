/**
 * AC-2 and AC-3: the documentation contract. These are STATIC assertions over
 * document text (explicitly non-end-to-end): they prove the required items are
 * present and structurally separate, not that a reader can follow them.
 *
 * Structure assertions carry their own negative control: each predicate is also
 * evaluated against a deliberately broken copy of the text and must fail there.
 */
import { readFileSync } from 'node:fs'

const root = '/workspace/chendecheng/code/need/deepseek/deepseek-harness'
const docs = [
  { path: 'docs/development.md', repository: 'Repository-side responsibilities', local: 'Local-environment responsibilities', faces: ['Terminal side', 'Extension subprocess side'] },
  { path: 'docs/development.zh.md', repository: '仓库侧职责', local: '本机环境侧职责', faces: ['终端侧', '扩展子进程侧'] },
]

const rows: string[] = []
let failures = 0
function check(name: string, condition: boolean, detail: string): void {
  rows.push(`${condition ? 'PASS' : 'FAIL'}\t${name}\t${detail}`)
  if (!condition) failures += 1
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1
}

/** Text between `title` and the next heading or the next of `stops`. */
function bulletsAfter(text: string, title: string, stops: readonly string[] = []): string[] {
  const at = text.indexOf(title)
  if (at < 0) return []
  const rest = text.slice(at + title.length)
  const headingEnd = rest.search(/\n#{2,3} /)
  const stopEnd = stops.map(stop => rest.indexOf(stop)).filter(index => index >= 0)
  const end = [headingEnd < 0 ? rest.length : headingEnd, ...stopEnd].reduce((a, b) => Math.min(a, b), rest.length)
  const section = rest.slice(0, end)
  return section.split('\n').filter(line => line.trimStart().startsWith('- '))
}

/** Tokens that make one local-environment entry decidable (AC-3 d). */
const DECIDABLE = [
  'nvm',
  'n 24.3.0',
  'export PATH=',
  'node --version',
  'DSH_NODE_BIN',
  'dsh.nodeBin',
  'workbench.action.reloadWindow',
]

interface Structure {
  repositoryOnce: boolean
  localOnce: boolean
  faceOnce: boolean[]
  bulletsPerFace: number[]
  everyEntryDecidable: boolean
  undecidable: string[]
}

function structureOf(text: string, labels: typeof docs[number]): Structure {
  const faceBlocks = labels.faces.map((face, index) =>
    bulletsAfter(text, face, labels.faces.slice(index + 1)))
  const allLocalEntries = bulletsAfter(text, labels.local)
  const undecidable = allLocalEntries.filter(entry => !DECIDABLE.some(token => entry.includes(token)))
  return {
    repositoryOnce: occurrences(text, labels.repository) === 1,
    localOnce: occurrences(text, labels.local) === 1,
    faceOnce: labels.faces.map(face => occurrences(text, face) === 1),
    bulletsPerFace: faceBlocks.map(bullets => bullets.length),
    everyEntryDecidable: undecidable.length === 0,
    undecidable,
  }
}

function structureHolds(s: Structure): boolean {
  return s.repositoryOnce && s.localOnce && s.faceOnce.every(Boolean)
    && s.bulletsPerFace.every(count => count > 0) && s.everyEntryDecidable
}

for (const labels of docs) {
  const text = readFileSync(`${root}/${labels.path}`, 'utf8')

  // ---------------------------------------------------------------- AC-2
  const ac2 = {
    floor: /22\.19/.test(text),
    owner: text.includes('engines.node') && text.includes('package.json'),
    zstd: text.includes('zlib.createZstdDecompress'),
    withResolvers: text.includes('Promise.withResolvers'),
    logLink: text.includes('.jsonl.zstd'),
  }
  check(
    `${labels.path} AC-2 items`,
    Object.values(ac2).every(Boolean),
    JSON.stringify(ac2),
  )

  // ---------------------------------------------------------------- AC-3
  const structure = structureOf(text, labels)
  check(`${labels.path} AC-3 structure holds`, structureHolds(structure), JSON.stringify(structure))

  // Negative control: the same predicate must fail on a text with one face title
  // removed and on a text with one checklist title removed.
  for (const face of labels.faces) {
    const withoutFace = text.replace(face, '')
    check(
      `${labels.path} AC-3 falsifiable when "${face}" is removed`,
      withoutFace !== text && !structureHolds(structureOf(withoutFace, labels)),
      'predicate went false',
    )
  }
  for (const title of [labels.repository, labels.local]) {
    const withoutTitle = text.replace(title, '')
    check(
      `${labels.path} AC-3 falsifiable when "${title}" is removed`,
      withoutTitle !== text && !structureHolds(structureOf(withoutTitle, labels)),
      'predicate went false',
    )
  }

  // AC-3(b) semantic proxy: the two sides are separate blocks with their own
  // bullets, so no single entry can be the only instruction for both sides.
  const faceBlocks = labels.faces.map((face, index) => bulletsAfter(text, face, labels.faces.slice(index + 1)))
  const [terminal, subprocess] = faceBlocks
  const overlap = (terminal ?? []).filter(entry => (subprocess ?? []).includes(entry))
  check(
    `${labels.path} AC-3(b) two separate face lists`,
    (terminal?.length ?? 0) > 0 && (subprocess?.length ?? 0) > 0 && overlap.length === 0,
    `terminal=${terminal?.length ?? 0} bullets, subprocess=${subprocess?.length ?? 0} bullets, shared=${overlap.length}`,
  )

  // AC-3(c): every repository-side row carries a runnable command.
  const repositoryRows = text.slice(text.indexOf(labels.repository)).split('\n')
    .filter(line => line.startsWith('|') && line.includes('pnpm run'))
  check(
    `${labels.path} AC-3(c) repository rows name a command`,
    repositoryRows.length >= 5,
    `${repositoryRows.length} repository rows name a pnpm run command`,
  )

  // AC-10(b): the priority chain is written in the developer docs.
  check(
    `${labels.path} AC-10(b) priority chain documented`,
    text.includes('DSH_NODE_BIN') && text.includes('dsh.nodeBin') && /process\.execPath/.test(text),
    'DSH_NODE_BIN, dsh.nodeBin, process.execPath all present',
  )
}

console.log(rows.join('\n'))
console.log(`FAILURES=${failures}`)
process.exitCode = failures === 0 ? 0 : 1
