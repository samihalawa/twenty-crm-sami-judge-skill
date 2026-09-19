#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const required = ['SKILL.md', 'agents/openai.yaml', 'agents/sami-judge.toml'];
for (const f of required) if (!existsSync(join(root, f))) errors.push(`Missing required file: ${f}`);

const read = (f) => (existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : '');
const skill = read('SKILL.md');
const toml = read('agents/sami-judge.toml');
const yaml = read('agents/openai.yaml');

if (!/^---\n[\s\S]*?\n---\n/.test(skill)) errors.push('SKILL.md frontmatter is missing or malformed');
if (!/^name: twenty-crm-sami-judge-skill$/m.test(skill)) errors.push('Unexpected skill name');
if (!/^description: This skill should be used /m.test(skill)) errors.push('Description must state when the skill should be used');

const body = skill.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
const tomlBody = toml.match(/developer_instructions = """\n([\s\S]*)\n"""\s*$/)?.[1];
if (!tomlBody) errors.push('Codex agent developer_instructions block is missing or malformed');
else if (tomlBody.trim() !== body) errors.push('Codex agent instructions have drifted from SKILL.md — regenerate agents/sami-judge.toml from SKILL.md');
if (!/^name = "sami-judge"$/m.test(toml)) errors.push('Codex agent name must be sami-judge');
if (!/^description = "/m.test(toml)) errors.push('Codex agent description is missing');

if (!yaml.includes('$twenty-crm-sami-judge-skill')) errors.push('Agent metadata does not invoke the skill by name');
const defaultPrompt = yaml.match(/default_prompt:\s*"([^"]*)"/)?.[1] ?? '';
if (!defaultPrompt) errors.push('Agent metadata default_prompt is missing');
if (defaultPrompt.split(/\s+/).filter(Boolean).length > 60) errors.push('Agent metadata default_prompt exceeds 60 words');

// The skill IS the final agent's own instructions: it must never spawn or delegate.
for (const phrase of ['You are the final agent', 'You do not spawn a subagent', 'You verify visually']) {
  if (!body.includes(phrase)) errors.push(`SKILL.md missing invariant: ${phrase}`);
}
if (/\b(spawn|launch|delegate to|dispatch) (a |an )?(sub-?agent|helper agent)\b/i.test(body.replace(/You do not spawn a subagent[^.]*\./g, ''))) {
  errors.push('SKILL.md instructs the agent to create a subagent');
}

// Sami's standing rules that must survive any edit.
for (const phrase of ['who pays', 'Bounces are the guard working', 'no priority', 'cost of delay',
  'Uncertainty is the bug', 'Zero silent failures', 'Nothing hidden', 'SAMI VERIFIED', 'SAMI REJECTED',
  'PARTIAL', 'BLOCKED', 'missing visual layer', 'title is not its filter', '+34 679 794 037']) {
  if (!body.includes(phrase)) errors.push(`SKILL.md missing standing rule: ${phrase}`);
}

const secretPatterns = [
  ['basic-auth URL', /https?:\/\/[^\s/:]+:[^\s@]+@/i],
  ['assigned credential', /\b(?:api[_ -]?key|token|password|secret)\s*[:=]\s*["']?[^\s<>{}[\]]+/i],
  ['authorization header value', /\bauthorization\s*:\s*(?:basic|bearer)\s+["']?[A-Za-z0-9+/_=.-]{8,}/i],
  ['common token prefix', /\b(?:gh[opsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['PEM private key', /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/],
];
for (const [name, content] of [['SKILL.md', skill], ['agents/sami-judge.toml', toml], ['agents/openai.yaml', yaml]]) {
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(content)) errors.push(`Possible reusable ${label} found in ${name}`);
  }
}

if (errors.length) {
  console.error('Package validation failed:');
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`Package structural validation passed: ${required.length} files, ${body.trim().split(/\s+/).length} instruction words, SKILL.md and Codex agent in sync`);
