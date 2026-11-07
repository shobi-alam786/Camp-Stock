package com.campstock.inventory.model

import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Minimal .xlsx writer with no extra libraries (pure JVM, unit-testable).
 * Several sheets, styled header, frozen header, filters, real numbers and real dates.
 * A number keeps the decimal places it was given (0.170 stays 0.170 in Excel).
 */
object XlsxWriter {
    sealed class Cell {
        data class Text(val v: String) : Cell()
        /** [v] is a plain decimal string; [scale] = digits after the point (0..6). */
        data class Num(val v: String, val scale: Int) : Cell()
        /** Excel date serial. */
        data class Date(val v: Int) : Cell()
    }

    class Sheet(val name: String, val header: List<String>, val rows: List<List<Cell?>>, val widths: List<Int> = emptyList())

    private fun esc(s: String): String = s
        .filter { it.code >= 32 || it == '\t' || it == '\n' || it == '\r' }
        .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")

    fun colName(i: Int): String {
        var s = ""
        var n = i + 1
        while (n > 0) { s = ('A' + (n - 1) % 26) + s; n = (n - 1) / 26 }
        return s
    }

    fun safeSheetName(name: String, used: MutableSet<String>): String {
        val base = name.replace(Regex("[:\\\\/?*\\[\\]]"), " ").trim().take(31).ifEmpty { "Sheet" }
        var n = base
        var i = 2
        while (!used.add(n.lowercase())) n = base.take(28) + " " + i++
        return n
    }

    // cellXfs: 0 text, 1 header, 2 date, 3 integer, 4..9 = 1..6 decimals
    private const val STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="7"><numFmt numFmtId="164" formatCode="yyyy\-mm\-dd"/><numFmt numFmtId="165" formatCode="0.0"/><numFmt numFmtId="166" formatCode="0.00"/><numFmt numFmtId="167" formatCode="0.000"/><numFmt numFmtId="168" formatCode="0.0000"/><numFmt numFmtId="169" formatCode="0.00000"/><numFmt numFmtId="170" formatCode="0.000000"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="168" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="169" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="170" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>"""

    private fun sheetXml(s: Sheet): String {
        val last = colName(maxOf(s.header.size - 1, 0))
        val lastRow = s.rows.size + 1
        val sb = StringBuilder()
        sb.append("""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>""").append('\n')
        sb.append("""<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>""")
        s.header.forEachIndexed { i, h ->
            val w = s.widths.getOrNull(i) ?: (h.length + 3).coerceIn(10, 45)
            sb.append("""<col min="${i + 1}" max="${i + 1}" width="$w" customWidth="1"/>""")
        }
        sb.append("</cols><sheetData><row r=\"1\">")
        s.header.forEachIndexed { i, h -> sb.append("""<c r="${colName(i)}1" s="1" t="inlineStr"><is><t>${esc(h)}</t></is></c>""") }
        sb.append("</row>")
        s.rows.forEachIndexed { ri, row ->
            val r = ri + 2
            sb.append("<row r=\"$r\">")
            row.forEachIndexed { ci, c ->
                val ref = "${colName(ci)}$r"
                when (c) {
                    null -> {}
                    is Cell.Text -> if (c.v.isNotEmpty()) sb.append("""<c r="$ref" t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>""")
                    is Cell.Date -> sb.append("""<c r="$ref" s="2"><v>${c.v}</v></c>""")
                    is Cell.Num -> sb.append("""<c r="$ref" s="${3 + c.scale.coerceIn(0, 6)}"><v>${esc(c.v)}</v></c>""")
                }
            }
            sb.append("</row>")
        }
        sb.append("""</sheetData><autoFilter ref="A1:$last$lastRow"/></worksheet>""")
        return sb.toString()
    }

    fun build(sheets: List<Sheet>): ByteArray {
        val used = HashSet<String>()
        val names = sheets.map { safeSheetName(it.name, used) }
        val bos = ByteArrayOutputStream()
        ZipOutputStream(bos).use { zip ->
            fun add(name: String, text: String) {
                zip.putNextEntry(ZipEntry(name)); zip.write(text.toByteArray(Charsets.UTF_8)); zip.closeEntry()
            }
            val ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
            val rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            val pkg = "http://schemas.openxmlformats.org/package/2006/relationships"
            val head = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
            val sheetOverrides = sheets.indices.joinToString("") {
                "<Override PartName=\"/xl/worksheets/sheet${it + 1}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"
            }
            add("[Content_Types].xml", head +
                "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
                "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
                "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
                "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>" +
                "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>" +
                sheetOverrides + "</Types>")
            add("_rels/.rels", head + "<Relationships xmlns=\"$pkg\">" +
                "<Relationship Id=\"rId1\" Type=\"$rel/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>")
            val sheetTags = names.mapIndexed { i, n -> "<sheet name=\"${esc(n)}\" sheetId=\"${i + 1}\" r:id=\"rId${i + 1}\"/>" }.joinToString("")
            add("xl/workbook.xml", head + "<workbook xmlns=\"$ns\" xmlns:r=\"$rel\"><sheets>$sheetTags</sheets></workbook>")
            val sheetRels = sheets.indices.joinToString("") {
                "<Relationship Id=\"rId${it + 1}\" Type=\"$rel/worksheet\" Target=\"worksheets/sheet${it + 1}.xml\"/>"
            }
            add("xl/_rels/workbook.xml.rels", head + "<Relationships xmlns=\"$pkg\">" + sheetRels +
                "<Relationship Id=\"rId${sheets.size + 1}\" Type=\"$rel/styles\" Target=\"styles.xml\"/></Relationships>")
            add("xl/styles.xml", STYLES)
            sheets.forEachIndexed { i, s -> add("xl/worksheets/sheet${i + 1}.xml", sheetXml(s)) }
        }
        return bos.toByteArray()
    }
}
