import { Pool, QueryResult } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export async function query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
  const start = Date.now();
  try {
    const res = await pool.query<T>(text, params);
    if (process.env.NODE_ENV !== 'production') {
      const duration = Date.now() - start;
      console.log('Executed query', { text, duration, rows: res.rowCount });
    }
    return res;
  } catch (error) {
    console.error('Error executing query', { text, error });
    throw error;
  }
}

// Helper to mimic Prisma's raw query tagged template behavior
export function sql(strings: TemplateStringsArray, ...values: any[]) {
  let text = '';
  const params: any[] = [];
  
  strings.forEach((string, i) => {
    text += string;
    if (i < values.length) {
      // Prisma.join handling
      if (values[i] && values[i].isPrismaJoin) {
        const joinValues = values[i].values;
        const paramPlaceholders = joinValues.map((val: any) => {
          if (val && val.isPrismaSql) {
            const nestedText = val.text;
            const nestedParams = val.params;
            let localNestedText = nestedText;
            nestedParams.forEach((param: any, idx: number) => {
              params.push(param);
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
      // Prisma.empty handling
      else if (values[i] && values[i].isPrismaEmpty) {
        // do nothing, add no text or params
      }
      // Prisma.sql handling (nested queries)
      else if (values[i] && values[i].isPrismaSql) {
        const nestedText = values[i].text;
        const nestedParams = values[i].params;
        // replace $1, $2 in nestedText with current param index
        let localNestedText = nestedText;
        nestedParams.forEach((param: any, idx: number) => {
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

// Mimic Prisma query execution
export const db = {
  $queryRaw: async <T = any>(strings: TemplateStringsArray, ...values: any[]): Promise<T[]> => {
    const queryData = sql(strings, ...values);
    const res = await query<T>(queryData.text, queryData.params);
    return res.rows;
  },
  $executeRaw: async (strings: TemplateStringsArray, ...values: any[]): Promise<number> => {
    const queryData = sql(strings, ...values);
    const res = await query(queryData.text, queryData.params);
    return res.rowCount || 0;
  }
};

// Prisma helper mimics
export const Prisma = {
  sql: sql,
  empty: { isPrismaEmpty: true },
  join: (values: any[], separator = ',') => ({ isPrismaJoin: true, values, separator })
};

export { pool };
