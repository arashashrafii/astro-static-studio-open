import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {NativeAuthGate,installationMessage} from '../apps/admin/src/native-auth.js';

test('browser mode keeps the local dashboard and explains Android-only GitHub sign-in',()=>{
 const html=renderToStaticMarkup(<NativeAuthGate><main>Local dashboard</main></NativeAuthGate>);
 assert.match(html,/ورود GitHub داخل برنامهٔ Android انجام می‌شود/);
 assert.match(html,/از API محلی همین دستگاه استفاده می‌کند/);
 assert.match(html,/<main>Local dashboard<\/main>/);
});

test('missing private-app installation is explained without implying sign-in installed it',()=>{
 const message=installationMessage(new Error('This GitHub account has no installation of this app.'));
 assert.match(message,/اتصال این برنامه برای حساب فعلی در دسترس نیست/);
 assert.match(message,/ورود به GitHub به‌تنهایی نصب برنامه را انجام نمی‌دهد/);
 assert.match(message,/این بررسی را دوباره اجرا کنید/);
});
