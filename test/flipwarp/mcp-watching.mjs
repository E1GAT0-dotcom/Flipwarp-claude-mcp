// Watching Claude work: plan, progress, identity, the control room, notes,
// taking over, tools reloading in place, and spotting an editor tab older
// than the editor.
//
// Start it, then open the editor address it prints. Three steps need a
// person (or a script in the page): when it says so, send a note from the
// timeline, press Take over, then Hand back. FLIPWARP_PORT picks the port
// (default 8670); FLIPWARP_BUILD the editor build to serve.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const mcpDir = path.join(here, '..', '..', 'mcp');
const require = createRequire(path.join(mcpDir, 'package.json'));
const {Client} = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
const {StdioClientTransport} = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
const {ToolListChangedNotificationSchema} = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/types.js')).href);

const port = Number(process.env.FLIPWARP_PORT) || 8670;
const build = path.resolve(process.env.FLIPWARP_BUILD || path.join(mcpDir, '..', 'build'));
let failures = 0;
const check = (ok, what, detail) => {
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok && detail) console.log(`       ${String(detail).slice(0, 700).split('\n').join('\n       ')}`);
    return ok;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const client = new Client({name: 'watching test', version: '0'});
let listChanged = 0;
client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    listChanged++;
});
await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [path.join(mcpDir, 'server.mjs')],
    env: {...process.env, FLIPWARP_PORT: String(port), FLIPWARP_BUILD: build, FLIPWARP_OPEN: ''},
    stderr: 'ignore'
}));
const call = async (tool, args = {}) => {
    const r = await client.callTool({name: tool, arguments: args});
    return {error: !!r.isError, text: r.content.filter(c => c.type === 'text').map(c => c.text).join('\n')};
};
const until = async (what, fn, ms = 90000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const r = await fn();
        if (r) return r;
        await sleep(1500);
    }
    return null;
};

const first = await call('open_editor', {launch: false});
const url = (first.text.match(/http:\/\/\S+/) || [''])[0].replace(/[.,]$/, '');
console.log(`\nopen:\n  ${url}\n`);
check(await until('editor', async () => !(await call('open_editor', {launch: false})).error, 120000),
    'the editor connects');

// --- the plan, identity and the control room ------------------------------------

let r = await call('plan', {steps: ['Draw the player', 'Write the code', 'Play it'], name: 'Watch Test',
    why: 'So the person can see how far along it is'});
check(/step 1 of 3: Draw the player/.test(r.text), 'the plan is shown', r.text);
await sleep(800);
const sessions = await (await fetch(`http://127.0.0.1:${port}/sessions`)).json();
const me = sessions.find(s => s.port === port);
check(me && me.name === 'Watch Test' && me.connected && me.plan && me.plan.steps.length === 3 && me.color,
    'the control room knows this chat: name, colour, plan', JSON.stringify(me || sessions).slice(0, 300));
const control = await fetch(`http://127.0.0.1:${port}/control`);
check(control.ok && /Flipwarp control room/.test(await control.text()), 'the control room page is served');
const buildId = await (await fetch(`http://127.0.0.1:${port}/build-id`)).text();
check(/^\d+$/.test(buildId), 'the build stamp is served', buildId);
const act = await fetch(`http://127.0.0.1:${port}/act?do=pause`, {method: 'POST', headers: {Origin: 'https://evil.example'}});
check(act.status === 403, 'a website cannot pause the game');

// --- doing things, with reasons ----------------------------------------------------

const box = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#e33"/></svg>';
check(!(await call('create_sprite', {name: 'Player', svg: box, why: 'The thing you play as'})).error, 'make a sprite');
check(!(await call('add_sound', {sprite: 'Player', name: 'jump', preset: 'jump', why: 'A sound for jumping'})).error,
    'add a sound');
await call('plan', {current: 2});
check(!(await call('write_sprite', {sprite: 'Player', why: 'Make it move', text: `whenGreenFlagClicked {
  forever {
    turnRight(3);
  }
}`})).error, 'write code');
await call('plan', {current: 3});
check(!(await call('green_flag', {wait_ms: 1500, why: 'Watch it spin'})).error, 'play it');
r = await call('play', {steps: [{do: 'wait', ms: 300}, {do: 'state'}, {do: 'screenshot'}], why: 'Check it spins'});
check(!r.error, 'a play sequence');
await call('stop');

// --- a note from the person -----------------------------------------------------------

console.log('NOTE: send a note from the timeline now');
r = await until('note', async () => {
    const reply = await call('project_overview');
    return /left you a note/.test(reply.text) ? reply : null;
});
check(r && /left you a note/.test(r.text), 'a note reaches Claude with its next step', r && r.text.slice(-200));

// --- taking over -------------------------------------------------------------------------

console.log('TAKEOVER: press Take over now');
r = await until('takeover', async () => {
    const reply = await call('write_sprite', {sprite: 'Player', text: 'whenGreenFlagClicked {\n  turnRight(5);\n}'});
    return reply.error && /taken over/.test(reply.text) ? reply : null;
});
check(r, 'while the person has the editor, a write is refused', r && r.text);
r = await call('project_overview');
check(!r.error && /taken over the editor/.test(r.text), 'looking still works, and says the person has it', r.text.slice(-200));
console.log('HANDBACK: press Hand back now');
r = await until('handback', async () => {
    const reply = await call('project_overview');
    return /handed the editor back/.test(reply.text) ? reply : null;
});
check(r, 'handing back tells Claude', r && r.text.slice(-300));

// --- tools reloading in place --------------------------------------------------------------

const toolsFile = path.join(mcpDir, 'tools.mjs');
const original = fs.readFileSync(toolsFile, 'utf8');
const before = listChanged;
try {
    fs.writeFileSync(toolsFile, `${original}\n// touched by the watching test\n`);
    await until('reload', async () => listChanged > before, 15000);
} finally {
    fs.writeFileSync(toolsFile, original);
}
check(listChanged > before, 'changing the tools tells Claude Code the tool list changed', `${listChanged}`);
await sleep(1500);
const tools = await client.listTools();
check(tools.tools.some(t => t.name === 'write_sprite') && tools.tools.some(t => t.name === 'plan'),
    'and the tools are all there afterwards', tools.tools.length);
check(!(await call('project_overview')).error, 'and still work, over the same connection');

// --- an editor tab older than the editor -------------------------------------------------

const editorHtml = path.join(build, 'editor.html');
const stamp = fs.statSync(editorHtml);
fs.utimesSync(editorHtml, stamp.atime, new Date(Date.now() + 60000));
r = await call('project_overview');
fs.utimesSync(editorHtml, stamp.atime, stamp.mtime);
check(/has been rebuilt since this editor tab opened/.test(r.text), 'an editor rebuilt since the tab opened is spotted',
    r.text.slice(-300));

// --- saving and ending ------------------------------------------------------------------

const file = path.join(os.tmpdir(), 'watch-test.sb3');
check(!(await call('save_project', {path: file})).error, 'save');
fs.rmSync(file, {force: true});
await call('plan', {status: 'done'});
await client.close();
await sleep(1500);
check(!fs.existsSync(path.join(os.tmpdir(), 'flipwarp-sessions', `${port}.json`)),
    'the chat leaves the control room when it ends');

if (failures) {
    console.log(`${failures} failure(s)`);
    process.exit(1);
}
console.log('watching: all passed');
process.exit(0);
