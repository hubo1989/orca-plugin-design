import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardPost } from '../src/post-guard.mjs';

const req = (headers = {}, method = 'POST') => ({
  method,
  headers,
});

test('guardPost: 合法同源 application/json 放行', () => {
  assert.equal(guardPost(req({ 'content-type': 'application/json', origin: 'http://127.0.0.1:3480', host: '127.0.0.1:3480' })), 0);
});

test('guardPost: 无 Origin（curl）放行', () => {
  assert.equal(guardPost(req({ 'content-type': 'application/json', host: '127.0.0.1:3480' })), 0);
});

test('guardPost: text/plain 跨站伪装 POST 拒绝 415', () => {
  // simple request 免预检路径：恶意网页最常用的通道
  assert.equal(guardPost(req({ 'content-type': 'text/plain', origin: 'http://evil.example', host: '127.0.0.1:3480' })), 415);
});

test('guardPost: application/json 但跨站 Origin 拒绝 403', () => {
  assert.equal(guardPost(req({ 'content-type': 'application/json', origin: 'http://evil.example', host: '127.0.0.1:3480' })), 403);
});

test('guardPost: 非法 Origin 头拒绝 403', () => {
  assert.equal(guardPost(req({ 'content-type': 'application/json', origin: 'not a url', host: '127.0.0.1:3480' })), 403);
});

test('guardPost: 非 POST 方法 405', () => {
  assert.equal(guardPost(req({ 'content-type': 'application/json' }, 'GET')), 405);
});

test('guardPost: content-type 带 charset 参数仍放行', () => {
  assert.equal(guardPost(req({ 'content-type': 'application/json; charset=utf-8', host: '127.0.0.1:3480' })), 0);
});
