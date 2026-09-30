/** SQLite syntax used by PeteZah, translated without changing strings or comments. */
export function tokenizeSql(sql) {
  const parts = [];
  const pattern = /(?:'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[(?:[^\]])*\]|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|\$([A-Za-z_][\w]*)?\$[\s\S]*?\$\1\$|\s+|::|@[A-Za-z_][\w]*|:[A-Za-z_][\w]*|[A-Za-z_][\w]*|\?|.)/g;
  for (const text of sql.match(pattern) || []) {
    let kind = 'symbol';
    if (/^\s+$/.test(text)) kind = 'space';
    else if (/^(--|\/\*)/.test(text)) kind = 'comment';
    else if (/^['$]/.test(text) && text !== '$') kind = 'string';
    else if (/^["`\[]/.test(text)) kind = 'identifier';
    else if (/^[A-Za-z_]\w*$/.test(text)) kind = 'word';
    else if (/^(\?|[@:][A-Za-z_]\w*)$/.test(text)) kind = 'parameter';
    parts.push({ text, kind });
  }
  return parts;
}

const upper = (token) => token?.text.toUpperCase();
const significant = (tokens) => tokens.map((t, i) => ({ ...t, index: i })).filter((t) => !['space', 'comment'].includes(t.kind));
const replaceKeys = { sessions: 'sid', cap_tokens: 'token_key', banned_ips: 'ip' };
const implicitColumns = { sessions: ['sid', 'sess', 'expire'] };

export function translateSql(sql, args = []) {
  let tokens = tokenizeSql(String(sql));
  let sig = significant(tokens);
  const pragma = String(sql).trim().match(/^PRAGMA\s+table_info\s*\(\s*([A-Za-z_][\w]*)\s*\)\s*;?$/i);
  if (pragma) {
    return {
      text: `SELECT ordinal_position - 1 AS cid, column_name AS name, data_type AS type,
        CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END AS "notnull", column_default AS dflt_value,
        CASE WHEN column_name IN (SELECT kcu.column_name FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
          AND kcu.constraint_schema = tc.constraint_schema
          WHERE tc.table_schema = current_schema() AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY')
          THEN 1 ELSE 0 END AS pk
        FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1
        ORDER BY ordinal_position`,
      values: [pragma[1]],
    };
  }
  if (sig.some((t) => upper(t) === 'PRAGMA')) throw new Error('Unsupported PostgreSQL PRAGMA');

  // DDL must hold JavaScript millisecond timestamps beyond signed 32-bit range.
  const ddl = sig.some((t) => ['CREATE', 'ALTER'].includes(upper(t)));
  if (ddl) {
    for (let i = 0; i < sig.length; i++) {
      if (upper(sig[i]) === 'INTEGER' && upper(sig[i + 1]) === 'PRIMARY' && upper(sig[i + 2]) === 'KEY' && upper(sig[i + 3]) === 'AUTOINCREMENT') {
        tokens[sig[i].index].text = 'BIGSERIAL';
        tokens[sig[i + 3].index].text = '';
      } else if (upper(sig[i]) === 'INTEGER') tokens[sig[i].index].text = 'BIGINT';
      else if (upper(sig[i]) === 'JSON') tokens[sig[i].index].text = 'TEXT';
    }
  }
  for (let i = 0; i < sig.length; i++) {
    if (upper(sig[i]) === 'DATETIME' && sig[i + 1]?.text === '(' && sig[i + 3]?.text === ')') {
      const value = sig[i + 2];
      const replacement = value.kind === 'string' && /^'now'$/i.test(value.text)
        ? 'CURRENT_TIMESTAMP'
        : value.kind === 'word' || value.kind === 'identifier'
          ? `(${value.text})::timestamptz`
          : null;
      if (!replacement) throw new Error('Unsupported SQLite datetime expression');
      tokens[sig[i].index].text = replacement;
      for (let j = i + 1; j <= i + 3; j++) tokens[sig[j].index].text = '';
    }
    // PostgreSQL folds unquoted aliases; callers expect SQLite's camelCase keys.
    if (upper(sig[i]) === 'AS' && sig[i + 1]?.kind === 'word' && /[A-Z]/.test(sig[i + 1].text) && /[a-z]/.test(sig[i + 1].text)) {
      tokens[sig[i + 1].index].text = `"${sig[i + 1].text}"`;
    }
  }

  let conflictClause = '';
  if (upper(sig[0]) === 'INSERT' && upper(sig[1]) === 'OR' && ['IGNORE', 'REPLACE'].includes(upper(sig[2]))) {
    const strategy = upper(sig[2]);
    tokens[sig[1].index].text = '';
    tokens[sig[2].index].text = '';
    if (strategy === 'IGNORE') conflictClause = ' ON CONFLICT DO NOTHING';
    else {
      const tableToken = sig[4];
      const table = tableToken?.text.toLowerCase();
      const key = replaceKeys[table];
      if (!key || upper(sig[3]) !== 'INTO') throw new Error('Unsupported SQLite INSERT OR REPLACE target');
      let columns = implicitColumns[table];
      if (sig[5]?.text === '(') {
        const end = sig.findIndex((t, index) => index > 5 && t.text === ')');
        columns = sig.slice(6, end).filter((t) => t.kind === 'word' || t.kind === 'identifier').map((t) => t.text);
      } else if (columns) tokens[tableToken.index].text += ` (${columns.join(', ')})`;
      if (!columns?.length || !columns.includes(key)) throw new Error('INSERT OR REPLACE requires explicit supported columns');
      conflictClause = ` ON CONFLICT (${key}) DO UPDATE SET ${columns.filter((c) => c !== key).map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`;
    }
  }

  let output = tokens.map((t) => t.text).join('');
  if (conflictClause) output = output.replace(/;\s*$/, '') + conflictClause;
  tokens = tokenizeSql(output);
  sig = significant(tokens);

  // In PostgreSQL an upsert RHS is ambiguous between target and EXCLUDED.
  const into = sig.findIndex((t) => upper(t) === 'INTO');
  const target = upper(sig[0]) === 'INSERT' && into >= 0 ? sig[into + 1]?.text : null;
  const set = sig.findIndex((t, i) => upper(t) === 'SET' && sig.slice(0, i).some((p) => upper(p) === 'CONFLICT'));
  if (target && set >= 0) {
    let depth = 0;
    let column = null;
    let onRhs = false;
    for (let i = set + 1; i < sig.length; i++) {
      const t = sig[i];
      if (t.text === '(') depth++;
      if (t.text === ')') depth--;
      if (depth === 0 && t.text === ',') { column = null; onRhs = false; continue; }
      if (!column && t.kind === 'word') { column = t.text; continue; }
      if (t.text === '=' && depth === 0 && !onRhs) { onRhs = true; continue; }
      if (onRhs && t.kind === 'word' && t.text === column && sig[i - 1]?.text !== '.' && sig[i + 1]?.text !== '.') {
        tokens[t.index].text = `${target}.${t.text}`;
      }
    }
  }

  const positional = args.flatMap((arg) => Array.isArray(arg) ? arg : [arg]);
  const named = positional[0] && typeof positional[0] === 'object' && !Buffer.isBuffer(positional[0]) && !(positional[0] instanceof Date)
    ? positional.shift() : null;
  const values = [];
  const names = new Map();
  let nextPosition = 0;
  for (const token of tokens) {
    if (token.kind !== 'parameter') continue;
    if (token.text === '?') {
      if (nextPosition >= positional.length) throw new RangeError('Too few SQL parameters');
      values.push(positional[nextPosition++]);
      token.text = `$${values.length}`;
    } else {
      const name = token.text.slice(1);
      if (!named || !Object.hasOwn(named, name)) throw new RangeError(`Missing SQL parameter ${name}`);
      if (!names.has(name)) { values.push(named[name]); names.set(name, values.length); }
      token.text = `$${names.get(name)}`;
    }
  }
  if (nextPosition !== positional.length) throw new RangeError('Too many SQL parameters');
  return { text: tokens.map((t) => t.text).join(''), values };
}
