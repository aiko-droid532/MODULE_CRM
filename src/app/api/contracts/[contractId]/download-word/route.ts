import { NextResponse } from 'next/server';
import { db as prisma } from '@/lib/db';
import { generateContractHtml } from '@/app/actions/contracts';

export async function GET(
  request: Request,
  { params }: { params: { contractId: string } }
) {
  try {
    const { contractId } = params;

    // Загружаем договор для имени файла
    const contracts: any[] = await prisma.$queryRaw`
      SELECT c."id", c."documentNumber", c."organizationId"
      FROM "Contract" c
      WHERE c.id = ${contractId}
      LIMIT 1
    `;
    const contract = contracts[0];
    if (!contract) {
      return NextResponse.json({ error: 'Договор не найден' }, { status: 404 });
    }

    // generateContractHtml возвращает строку (HTML или текст ошибки)
    const htmlResult = await generateContractHtml(contractId);

    // Проверяем что вернулось — строка с HTML или сообщение об ошибке
    if (
      !htmlResult ||
      htmlResult === 'Договор не найден' ||
      htmlResult === 'Ошибка генерации документа'
    ) {
      return NextResponse.json(
        { error: htmlResult || 'Не удалось сгенерировать договор' },
        { status: 500 }
      );
    }

    // Оборачиваем в Word-совместимый HTML документ
    const wordHtml = `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office'
      xmlns:w='urn:schemas-microsoft-com:office:word'
      xmlns='http://www.w3.org/TR/REC-html40'>
<head>
  <meta charset='utf-8'>
  <title>Договор ${contract.documentNumber}</title>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
      <w:DoNotOptimizeForBrowser/>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <style>
    @page {
      size: A4;
      margin: 2.5cm 2cm 2.5cm 3cm;
    }
    body {
      font-family: 'Times New Roman', Times, serif;
      font-size: 12pt;
      line-height: 1.5;
      color: #000;
    }
    table { border-collapse: collapse; width: 100%; }
    td, th { padding: 4pt 6pt; border: 1pt solid #000; }
    h1, h2, h3 { font-family: Arial, sans-serif; }
    p { margin: 6pt 0; text-align: justify; }
  </style>
</head>
<body>
${htmlResult}
</body>
</html>`;

    const filename = `Договор_${contract.documentNumber}.doc`;

    return new NextResponse(wordHtml, {
      status: 200,
      headers: {
        'Content-Type': 'application/msword',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error: any) {
    console.error('Word download error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
