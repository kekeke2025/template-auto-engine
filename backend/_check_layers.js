const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '123456',
    database: 'psd_template'
  });
  const [rows] = await conn.query('SELECT id, name, CAST(sizeVariants AS CHAR) as sv FROM templates WHERE id = 18');
  if (rows.length > 0 && rows[0].sv) {
    const v = JSON.parse(rows[0].sv);
    console.log('模板:', rows[0].name, ' 尺寸数:', v.length);
    const firstLayers = v[0].layers || [];
    console.log('第一个尺寸的图层数:', firstLayers.length);

    // 扁平化
    const flat = [];
    function flatten(arr) {
      for (const l of arr) {
        if (l.type === 'group' && l.children) flatten(l.children);
        else flat.push({ name: l.name, type: l.type, editable: l.editable });
      }
    }
    flatten(firstLayers);
    console.log('扁平化后图层数:', flat.length);
    console.log('所有图层:');
    flat.forEach((l, i) => console.log(`  ${i+1}. [${l.type}] ${l.name}  editable=${l.editable}`));
  }
  await conn.end();
})().catch(e => console.error(e.message, e.stack));
