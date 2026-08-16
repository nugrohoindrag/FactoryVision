import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

/**
 * B-081 — Excel and PDF, and the decision behind BP-05.
 *
 * ## Excel
 *
 * ExcelJS, not SheetJS. That looks inconsistent with Tech Stack §2.3 until you
 * notice the two are doing opposite jobs: SheetJS is on the DEVICE because
 * reading a factory's real spreadsheet means surviving merged cells, headers on
 * row seven and dates in four formats. Writing a clean report has none of those
 * problems, and ExcelJS is on npm under MIT with no CDN tarball to pin.
 *
 * ## PDF — BP-05 decided
 *
 * Chromium-headless PDF was the other candidate and is refused. It is 300 MB of
 * dependency, it needs a sandbox, and it cannot run on the shared hosting the
 * business may still choose (BP-02). What these reports actually are is tables
 * of numbers with a heading, and pdfkit draws those in a few hundred kilobytes.
 *
 * The cost of that choice, stated rather than discovered later: no CSS, no page
 * templates, no charts. If a report ever genuinely needs those, it should be
 * rendered on the device that already has the data and the styling.
 *
 * ## Both carry the caveats
 *
 * A variance row against an unverified recipe is marked in the file, not only
 * on the screen. A report printed for a meeting has lost its screen — and the
 * printout is what decisions get made from.
 */

export interface Column {
  key: string;
  header: string;
  width?: number;
}

@Injectable()
export class ExportService {
  async toExcel(input: {
    title: string;
    columns: readonly Column[];
    rows: readonly Record<string, unknown>[];
    caveats?: readonly string[];
  }): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'FactoryVision';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet(input.title.slice(0, 31));

    sheet.addRow([input.title]);
    sheet.getRow(1).font = { bold: true, size: 14 };
    sheet.addRow([`Generated ${new Date().toISOString()}`]);

    for (const caveat of input.caveats ?? []) {
      const row = sheet.addRow([caveat]);
      row.font = { italic: true };
    }
    sheet.addRow([]);

    const headerRow = sheet.addRow(input.columns.map((column) => column.header));
    headerRow.font = { bold: true };

    input.columns.forEach((column, index) => {
      sheet.getColumn(index + 1).width = column.width ?? 18;
    });

    for (const row of input.rows) {
      sheet.addRow(
        input.columns.map((column) => {
          const value = row[column.key];
          /**
           * Quantities stay TEXT in the sheet.
           *
           * Excel stores numbers as binary floats, so `81.5` written as a number
           * can come back as `81.49999999999999` — the exact failure decimal
           * strings exist to avoid everywhere else in this product (Tech Stack
           * §2.4). A number that is only ever read, filtered and printed loses
           * nothing by being text, and it stays the figure the system computed.
           */
          return value === null || value === undefined ? '' : String(value);
        }),
      );
    }

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async toPdf(input: {
    title: string;
    columns: readonly Column[];
    rows: readonly Record<string, unknown>[];
    caveats?: readonly string[];
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(16).text(input.title);
      doc.fontSize(9).fillColor('#555').text(`Generated ${new Date().toISOString()}`);

      for (const caveat of input.caveats ?? []) {
        doc.fontSize(9).fillColor('#8a5a00').text(caveat);
      }
      doc.moveDown(0.8).fillColor('#000');

      const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const columnWidth = usable / input.columns.length;

      const writeRow = (values: string[], bold: boolean) => {
        const y = doc.y;
        doc.fontSize(9);
        values.forEach((value, index) => {
          doc.text(value, doc.page.margins.left + index * columnWidth, y, {
            width: columnWidth - 6,
            ellipsis: true,
          });
        });
        doc.moveDown(0.2);
        if (bold) {
          doc
            .moveTo(doc.page.margins.left, doc.y)
            .lineTo(doc.page.width - doc.page.margins.right, doc.y)
            .strokeColor('#999')
            .stroke();
          doc.moveDown(0.2);
        }
      };

      writeRow(
        input.columns.map((column) => column.header),
        true,
      );

      for (const row of input.rows) {
        // A page break mid-table needs the headers again, or page four is a
        // grid of numbers with nothing saying what they are.
        if (doc.y > doc.page.height - doc.page.margins.bottom - 24) {
          doc.addPage();
          writeRow(
            input.columns.map((column) => column.header),
            true,
          );
        }
        writeRow(
          input.columns.map((column) => {
            const value = row[column.key];
            return value === null || value === undefined ? '' : String(value);
          }),
          false,
        );
      }

      doc.end();
    });
  }
}
