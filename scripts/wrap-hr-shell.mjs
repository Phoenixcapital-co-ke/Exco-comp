import fs from 'fs'
import path from 'path'

const files = [
  ['Demographics', 'DEMOGRAPHICS'],
  ['Departments', 'DEPARTMENTS'],
  ['Branches', 'BRANCHES'],
  ['Contracts', 'CONTRACTS'],
  ['Directory', 'DIRECTORY'],
  ['Analytics', 'ANALYTICS'],
]

for (const [name, label] of files) {
  const p = path.join('src/pages/hr', `${name}.jsx`)
  let s = fs.readFileSync(p, 'utf8')
  if (s.includes('HrShell')) {
    console.log(`${name}: already wrapped`)
    continue
  }

  if (!s.includes("from '../../components/hr/HrUi")) {
    if (s.includes("from '../../utils/api.js'")) {
      s = s.replace(
        "from '../../utils/api.js'",
        "from '../../utils/api.js'\nimport { HrShell, HrToolbar } from '../../components/hr/HrUi.jsx'"
      )
    } else {
      const firstImportEnd = s.indexOf('\n\n')
      s =
        s.slice(0, firstImportEnd) +
        "\nimport { HrShell, HrToolbar } from '../../components/hr/HrUi.jsx'" +
        s.slice(firstImportEnd)
    }
  }

  // Wrap main content return that starts with space-y-
  const marker = '  return (\n    <div className="space-y-'
  const idx = s.lastIndexOf(marker)
  if (idx === -1) {
    console.log(`${name}: no space-y return found`)
    fs.writeFileSync(p, s)
    continue
  }

  s =
    s.slice(0, idx) +
    `  return (\n    <HrShell>\n      <HrToolbar page="${label}" />\n    <div className="space-y-` +
    s.slice(idx + marker.length)

  // Close HrShell before the closing of this return: find matching end
  // Look for `\n  )\n}` near end of function (before export default)
  const exportIdx = s.lastIndexOf('\nexport default')
  const closeIdx = s.lastIndexOf('\n  )\n}', exportIdx)
  if (closeIdx !== -1) {
    // Insert </HrShell> before `\n  )`
    s = s.slice(0, closeIdx) + '\n    </HrShell>' + s.slice(closeIdx)
  }

  fs.writeFileSync(p, s)
  console.log(`${name}: wrapped`)
}
