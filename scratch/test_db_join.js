// Simple mock of sql and Prisma.join to verify query text generation
function join(values, separator = ',') {
  return { isPrismaJoin: true, values, separator };
}

function sql(strings, ...values) {
  let text = '';
  const params = [];
  
  strings.forEach((string, i) => {
    text += string;
    if (i < values.length) {
      if (values[i] && values[i].isPrismaJoin) {
        const joinValues = values[i].values;
        const paramPlaceholders = joinValues.map((val) => {
          if (val && val.isPrismaSql) {
            const nestedText = val.text;
            const nestedParams = val.params;
            let localNestedText = nestedText;
            nestedParams.forEach((param, idx) => {
              params.push(param);
              // Replace specifically the index placeholder to avoid replacing already updated ones
              localNestedText = localNestedText.replace(`$${idx + 1}`, `$${params.length}`);
            });
            return localNestedText;
          } else {
            params.push(val);
            return `$${params.length}`;
          }
        });
        text += paramPlaceholders.join(values[i].separator);
      } 
      else if (values[i] && values[i].isPrismaSql) {
        const nestedText = values[i].text;
        const nestedParams = values[i].params;
        let localNestedText = nestedText;
        nestedParams.forEach((param, idx) => {
          params.push(param);
          localNestedText = localNestedText.replace(`$${idx + 1}`, `$${params.length}`);
        });
        text += localNestedText;
      }
      else {
        params.push(values[i]);
        text += `$${params.length}`;
      }
    }
  });

  return { text, params, isPrismaSql: true };
}

// Test case 1: simple update list with Prisma.join
const nameVal = 'Alice';
const phoneVal = '+777';
const idVal = 'uuid-123';

const updates = [
  sql`"name" = ${nameVal}`,
  sql`"phone" = ${phoneVal}`
];

const query = sql`
  UPDATE "Lead"
  SET ${join(updates, ', ')}, "updatedAt" = NOW()
  WHERE id = ${idVal}
`;

console.log('--- TEST 1 ---');
console.log('SQL:', query.text.trim());
console.log('Params:', query.params);

// Test case 2: nested queries with multiple parameters
const nestedWithMultiParams = sql`"col1" = ${'v1'} AND "col2" = ${'v2'}`;
const mainQuery = sql`SELECT * FROM t WHERE ${nestedWithMultiParams} AND id = ${'v3'}`;

console.log('\n--- TEST 2 ---');
console.log('SQL:', mainQuery.text.trim());
console.log('Params:', mainQuery.params);
