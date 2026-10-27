const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// The shared file is a browser script; load it the way a page would.
const sandbox = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync(require.resolve('./public/shared/announcement-markup.js'), 'utf8'), sandbox);
const { toHtml, toPlainText } = sandbox.AnnouncementMarkup;

test('plain legacy text keeps line breaks and is escaped', () => {
  assert.equal(toHtml('第一行\n<script>alert(1)</script>'), '第一行<br>&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('basic styling tags map to whitelisted html', () => {
  assert.equal(toHtml('[b]粗[/b][i]斜[/i][u]线[/u]'), '<strong>粗</strong><em>斜</em><u>线</u>');
  assert.equal(toHtml('[color=#ff6b6b]红[/color]'), '<span style="color:#ff6b6b">红</span>');
  assert.equal(toHtml('[size=20]大[/size]'), '<span style="font-size:20px">大</span>');
});

test('size is clamped and invalid values are shown as text', () => {
  assert.match(toHtml('[size=999]x[/size]'), /font-size:40px/);
  assert.match(toHtml('[size=2]x[/size]'), /font-size:12px/);
  assert.equal(toHtml('[color=red"onload=1]x[/color]'), '[color=red&quot;onload=1]x');
  assert.equal(toHtml('[color=url(javascript:1)]x'), '[color=url(javascript:1)]x');
});

test('font uses a fixed whitelist', () => {
  assert.match(toHtml('[font=kai]字[/font]'), /font-family:/);
  assert.equal(toHtml('[font=evil]字[/font]'), '[font=evil]字');
});

test('unclosed tags are closed and stray closers dropped', () => {
  assert.equal(toHtml('[b]粗'), '<strong>粗</strong>');
  assert.equal(toHtml('粗[/b]'), '粗');
  assert.equal(toHtml('[b][i]x[/b]y'), '<strong><em>x</em></strong>y');
});

test('images only allow uploads paths and http(s) urls', () => {
  assert.match(toHtml('[img]/uploads/announcements/a.png[/img]'), /<img class="ann-img" src="\/uploads\/announcements\/a\.png"/);
  assert.match(toHtml('[img]https://example.com/a.png[/img]'), /<img /);
  assert.ok(!toHtml('[img]javascript:alert(1)[/img]').includes('<img'));
  assert.ok(!toHtml('[img]/uploads/../../etc/passwd"onerror=1[/img]').includes('<img'));
});

test('emoji pass through untouched', () => {
  assert.equal(toHtml('上新啦 🎉'), '上新啦 🎉');
});

test('toPlainText strips tags for summaries', () => {
  assert.equal(toPlainText('[b]新[/b] 功能\n[img]/uploads/a.png[/img]'), '新 功能 [图片]');
});
