import assert from 'node:assert/strict';
import test from 'node:test';
import { sameOrigin } from '../server/request-origin.ts';
test('cookie writes accept only the exact configured origin', () => {
  const prior = process.env.BETTER_AUTH_URL;
  process.env.BETTER_AUTH_URL = 'https://alineo.example.test';
  try {
    for (const [origin,expected] of [['https://alineo.example.test',true],['https://other.apps.neander.ai',false],['https://alineo.example.test.evil.test',false],['http://alineo.example.test',false],['null',false]]) {
      assert.equal(sameOrigin(new Request('http://internal/api/teams',{method:'POST',headers:{origin}})),expected);
    }
    assert.equal(sameOrigin(new Request('http://internal/api/teams',{method:'POST'})),false);
    delete process.env.BETTER_AUTH_URL;
    assert.equal(sameOrigin(new Request('http://internal/api/teams',{method:'POST',headers:{origin:'https://alineo.example.test'}})),false);
  } finally { if(prior===undefined)delete process.env.BETTER_AUTH_URL;else process.env.BETTER_AUTH_URL=prior; }
});
