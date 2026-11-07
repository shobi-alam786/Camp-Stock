package com.campstock.inventory

import com.campstock.inventory.model.IomBalanceWorkbook
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class IomBalanceWorkbookTest {
    @Test fun readsCachedTotalsFromActual26CsrWorkbookWhenAvailable() {
        val workbook = findWorkbook()
        assumeTrue("26CSR.xlsx is not present in this checkout", workbook?.isFile == true)

        val rows = IomBalanceWorkbook.read(workbook!!)
        assertEquals(472, rows.size)
        assertEquals(IomBalanceWorkbook.Row("Roller compacter", "Pcs", "0"), rows[0])
        assertEquals(IomBalanceWorkbook.Row("Steel compactor (manual)", "Pcs", "7"), rows[1])
        assertEquals(348, rows.count { it.total == "0" })
        assertEquals(124, rows.count { it.total.isNotBlank() && it.total != "0" })
        assertEquals(0, rows.count { it.total.isBlank() })
        val projection = rows.joinToString("\n") { "${it.item}\t${it.unit}\t${it.total}" }
        val hash = MessageDigest.getInstance("SHA-256").digest(projection.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        assertEquals("59b46a6d49337250e59c73782450f6e6ad4865905a7b5eb7d981fc8339472773", hash)
    }

    @Test fun preservesBlankZeroAndCachedFormulaValue() {
        val file = File.createTempFile("iom-balance-test-", ".xlsx")
        try {
            ZipOutputStream(file.outputStream()).use { zip ->
                zipEntry(zip, "xl/workbook.xml", """
                    <workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
                      <sheets><sheet name="BALANCE - CAMP" r:id="rId1"/></sheets>
                    </workbook>
                """.trimIndent())
                zipEntry(zip, "xl/_rels/workbook.xml.rels", """
                    <Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>
                """.trimIndent())
                zipEntry(zip, "xl/sharedStrings.xml", """
                    <sst><si><t>items</t></si><si><t>unit</t></si><si><t>TOTAL</t></si>
                      <si><t>Zero item</t></si><si><t>Pcs</t></si><si><t>Blank item</t></si>
                      <si><t>Cached item</t></si></sst>
                """.trimIndent())
                zipEntry(zip, "xl/worksheets/sheet1.xml", """
                    <worksheet><sheetData>
                      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
                      <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2"><v>0</v></c></row>
                      <row r="3"><c r="A3" t="s"><v>5</v></c><c r="B3" t="s"><v>4</v></c></row>
                      <row r="4"><c r="A4" t="s"><v>6</v></c><c r="B4" t="s"><v>4</v></c><c r="C4"><f>40+2</f><v>42</v></c></row>
                    </sheetData></worksheet>
                """.trimIndent())
            }

            assertEquals(
                listOf(
                    IomBalanceWorkbook.Row("Zero item", "Pcs", "0"),
                    IomBalanceWorkbook.Row("Blank item", "Pcs", ""),
                    IomBalanceWorkbook.Row("Cached item", "Pcs", "42")
                ),
                IomBalanceWorkbook.read(file)
            )
        } finally {
            file.delete()
        }
    }

    private fun findWorkbook(): File? {
        System.getenv("IOM_BALANCE_TEST_WORKBOOK")?.let { path ->
            val configured = File(path)
            if (configured.isFile) return configured
        }
        var directory: File? = File(System.getProperty("user.dir")).absoluteFile
        repeat(6) {
            val candidate = directory?.resolve("26CSR.xlsx")
            if (candidate?.isFile == true) return candidate
            directory = directory?.parentFile
        }
        return null
    }

    private fun zipEntry(zip: ZipOutputStream, name: String, content: String) {
        zip.putNextEntry(ZipEntry(name))
        zip.write(content.toByteArray(Charsets.UTF_8))
        zip.closeEntry()
    }
}
