#!/usr/bin/env node
'use strict';
/** Gate production dependency advisories, emitting actionable package details.
 * Reads npm audit's machine-readable output. Never edits the lockfile. */
const fs = require('node:fs');

function summarize(report) {
  if (!report || typeof report !== 'object' || report.error ||
      !report.vulnerabilities || typeof report.vulnerabilities !== 'object') {
    return { status: 2, lines: ['Audit unavailable or invalid; cannot certify dependencies.'] };
  }
  const entries = Object.entries(report.vulnerabilities).sort(([a],[b]) => a.localeCompare(b));
  const lines = [];
  let blocking = 0;
  for (const [name, v] of entries) {
    if (!v || typeof v !== 'object') continue;
    const severity = v.severity || 'unknown';
    if (severity === 'critical' || severity === 'high') blocking++;
    const via = (Array.isArray(v.via) ? v.via : []).map(x =>
      typeof x === 'string' ? x : (x.name || x.title || 'advisory')).slice(0, 3);
    const fix = typeof v.fixAvailable === 'object'
      ? (v.fixAvailable.name + '@' + v.fixAvailable.version)
      : (v.fixAvailable === true ? 'available' : 'none indicated');
    lines.push(`${severity.toUpperCase()} ${name} (direct=${!!v.isDirect}; fix=${fix}; via=${via.join(',')})`);
  }
  const totals = report.metadata?.vulnerabilities || {};
  lines.unshift(`Reported prod dependency advisories: critical=${totals.critical ?? '?'}, high=${totals.high ?? '?'}, moderate=${totals.moderate ?? '?'}, low=${totals.low ?? '?'}`);
  lines.push(`Blocking high/critical package entries: ${blocking}`);
  return { status: blocking ? 1 : 0, lines };
}

if (require.main === module) {
  let report;
  try { report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); }
  catch (error) {
    console.error('Missing/malformed audit JSON:', error.message);
    process.exit(2);
  }
  const {status, lines} = summarize(report);
  for (const line of lines) console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '### TinyClaw production dependency audit\n\n```text\n' +
      lines.join('\n') + '\n```\n\n');
  }
  process.exit(status);
}
module.exports = {summarize};
