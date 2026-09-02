import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { welcomeEmail, sendMail, mailEnabled } from '../src/services/mailService.js';

/**
 * The welcome message.
 *
 * Email is never the point of the request that triggers it: nobody registers in
 * order to receive a greeting. So the properties worth holding are that it
 * cannot break the thing the person actually asked for, and that a name typed
 * by a stranger cannot become markup in someone else's inbox.
 */

describe('a message to a new account', () => {
  test('greets the person and points at the one useful action', () => {
    const message = welcomeEmail({ name: 'Pankaj Kumar', email: 'pankaj@example.com' });

    assert.match(message.subject, /account is ready/i);
    assert.match(message.text, /Hello Pankaj,/);
    assert.match(message.text, /\/create/, 'the next step is a link, not an instruction to go looking');
    assert.match(message.text, /pankaj@example\.com/, 'says which address it belongs to');
  });

  test('does not claim any money has moved', () => {
    const { text } = welcomeEmail({ name: 'A', email: 'a@b.c' });
    assert.ok(!/paid|released|transferred/i.test(text));
  });

  test('falls back to a greeting when the name is unusable', () => {
    assert.match(welcomeEmail({ name: '   ', email: 'a@b.c' }).text, /Hello there,/);
    assert.match(welcomeEmail({ email: 'a@b.c' }).text, /Hello there,/);
  });

  test('treats a name and an address as text, never as markup', () => {
    const message = welcomeEmail({
      name: '<script>alert(1)</script>',
      email: '"><img src=x onerror=alert(1)>@evil.test',
    });

    assert.ok(!message.html.includes('<script>'), 'a name a stranger chose is not markup');
    assert.ok(!message.html.includes('<img src=x'), 'nor is an address');
    assert.match(message.html, /&lt;script&gt;/);
  });
});

describe('sending, with no mail server configured', () => {
  test('reports that nothing was sent rather than pretending', async () => {
    assert.equal(mailEnabled(), false, 'the test environment has no SMTP credentials');

    const result = await sendMail({ to: 'a@b.c', subject: 'Test', text: 'body' });

    assert.equal(result.sent, false);
    assert.match(result.reason, /not configured/i);
  });

  test('resolves rather than throwing, because a greeting must not fail a signup', async () => {
    // The caller does not await this, so a rejection would be unhandled and
    // would take the process down with it.
    await assert.doesNotReject(() => sendMail({ to: 'a@b.c', subject: 'x', text: 'y' }));
  });
});
