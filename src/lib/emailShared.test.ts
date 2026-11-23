// @vitest-environment node
import { escapeHtml, safeUrl, textToHtml, wrapLayout } from '../../supabase/functions/_shared/layout';
import { signSvix, verifySvix } from '../../supabase/functions/_shared/svix';

describe('email layout', () => {
  it('escapes HTML so a name or message cannot inject markup', () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;');
    expect(textToHtml('<b>hi</b>')).toBe('<p style="margin:0 0 14px">&lt;b&gt;hi&lt;/b&gt;</p>');
  });
  it('turns blank lines into paragraphs and single newlines into line breaks', () => {
    const html = textToHtml('one\ntwo\n\nthree');
    expect(html).toContain('one<br>two');
    expect(html.match(/<p /g)?.length).toBe(2);
  });
  it('accepts only http and https links', () => {
    expect(safeUrl('https://learn.example.org')).toBe('https://learn.example.org/');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl(undefined)).toBeNull();
  });
  it('wraps the message with branding, the subject escaped, and no button without an app link', () => {
    const html = wrapLayout('Hi <you>', 'Body', undefined);
    expect(html).toContain('Hi &lt;you&gt;');
    expect(html).toContain('2026 DIRA Foundation');
    expect(html).not.toContain('Open DIRA Learn');
    expect(wrapLayout('S', 'B', 'https://x.org')).toContain('Open DIRA Learn');
  });
});

describe('webhook signature', () => {
  const secret = 'whsec_' + btoa('super-secret-key-bytes');
  const now = 1_800_000_000;
  const body = '{"type":"email.delivered"}';
  it('accepts a correct, fresh signature', async () => {
    const sig = await signSvix(secret, 'msg_1', String(now), body);
    expect(await verifySvix(secret, { id: 'msg_1', timestamp: String(now), signature: sig }, body, now)).toBe(true);
  });
  it('accepts when one of several space-separated signatures matches', async () => {
    const sig = await signSvix(secret, 'msg_1', String(now), body);
    expect(await verifySvix(secret, { id: 'msg_1', timestamp: String(now), signature: `v1,AAAA ${sig}` }, body, now)).toBe(true);
  });
  it('rejects a tampered body, a wrong secret and missing headers', async () => {
    const sig = await signSvix(secret, 'msg_1', String(now), body);
    expect(await verifySvix(secret, { id: 'msg_1', timestamp: String(now), signature: sig }, body + ' ', now)).toBe(false);
    expect(await verifySvix('whsec_' + btoa('other'), { id: 'msg_1', timestamp: String(now), signature: sig }, body, now)).toBe(false);
    expect(await verifySvix(secret, { id: null, timestamp: String(now), signature: sig }, body, now)).toBe(false);
  });
  it('rejects an old timestamp (replay)', async () => {
    const old = String(now - 3600);
    const sig = await signSvix(secret, 'msg_1', old, body);
    expect(await verifySvix(secret, { id: 'msg_1', timestamp: old, signature: sig }, body, now)).toBe(false);
  });
});
