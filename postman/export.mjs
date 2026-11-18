// Generates the Postman Desktop import files (Collection v2.1 + environment) from the v3 YAML, which stays the
// source of truth: never edit postman/export/*.json by hand. Usage: npm run postman:export
// The Postman CLI resolves the YAML (order, inherited folders, examples) into v3 JSON; this only maps shapes.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const root = new URL('./', import.meta.url).pathname;
const cli = (...args) => JSON.parse(execFileSync('postman', args, { cwd: root, encoding: 'utf8' }));
const collection = cli('collection', 'get', 'collections/Charales', '--json');
const environment = cli('environment', 'get', 'environments/local.environment.yaml', '--json');

const EVENTS = { beforeRequest: 'prerequest', afterResponse: 'test' };
const headers = (list = []) => list.map(({ key, value }) => ({ key, value }));
const body = (b) =>
  b?.content === undefined
    ? undefined
    : {
        mode: 'raw',
        raw: b.content,
        options: { raw: { language: b.type === 'json' ? 'json' : 'text' } },
      };
const request = (r) => ({
  method: r.method,
  header: headers(r.headers),
  ...(body(r.body) && { body: body(r.body) }),
  url: r.url,
});

function item(node) {
  if (node.$kind === 'collection')
    return { name: node.name, description: node.description, item: node.items.map(item) };
  if (node.$kind !== 'http-request')
    throw new Error(`Tipo no soportado: ${node.$kind} (${node.name})`);
  return {
    name: node.name,
    event: (node.scripts ?? []).map((s) => {
      if (!EVENTS[s.type]) throw new Error(`Script no soportado: ${s.type} (${node.name})`);
      return {
        listen: EVENTS[s.type],
        script: { type: 'text/javascript', exec: s.code.split('\n') },
      };
    }),
    request: { ...request(node), description: node.description },
    response: (node.examples ?? []).map((e) => ({
      name: e.name,
      originalRequest: request(e.request),
      status: e.response.statusText,
      code: e.response.statusCode,
      header: headers(e.response.headers),
      body: e.response.body?.content ?? '',
      _postman_previewlanguage: e.response.body?.type === 'json' ? 'json' : 'text',
    })),
  };
}

const out = {
  info: {
    name: collection.name,
    description: collection.description,
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: collection.items.map(item),
};
const env = {
  name: environment.name,
  values: environment.values.map(({ key, value, enabled, type }) => ({
    key,
    value,
    enabled,
    type,
  })),
  _postman_variable_scope: 'environment',
};

mkdirSync(`${root}export`, { recursive: true });
const write = (file, data) =>
  writeFileSync(`${root}export/${file}`, JSON.stringify(data, null, 2) + '\n');
write(`${out.info.name}.postman_collection.json`, out);
write(`${env.name}.postman_environment.json`, env);
const count = (items) => items.reduce((n, i) => n + (i.item ? count(i.item) : 1), 0);
console.log(
  `postman/export: ${count(out.item)} peticiones en ${out.item.length} carpetas; environment «${env.name}».`,
);
