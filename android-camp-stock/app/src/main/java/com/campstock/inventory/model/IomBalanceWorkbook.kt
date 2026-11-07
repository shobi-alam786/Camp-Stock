package com.campstock.inventory.model

import org.w3c.dom.Element
import java.io.File
import java.util.zip.ZipFile
import javax.xml.XMLConstants
import javax.xml.parsers.DocumentBuilderFactory

/** Cached values from BALANCE - CAMP. This reader does not evaluate Excel formulas. */
object IomBalanceWorkbook {
    data class Row(val item: String, val unit: String, val total: String)

    fun read(file: File): List<Row> {
        ZipFile(file).use { zip ->
            fun document(path: String) = zip.getEntry(path)?.let { entry ->
                zip.getInputStream(entry).use { input ->
                    secureFactory().newDocumentBuilder().parse(input)
                }
            } ?: throw IllegalArgumentException("Workbook is missing $path.")

            val workbook = document("xl/workbook.xml")
            val relationships = document("xl/_rels/workbook.xml.rels")
            val sheets = workbook.getElementsByTagName("sheet")
            val balanceSheet = (0 until sheets.length).asSequence()
                .map { sheets.item(it) as Element }
                .firstOrNull { normalize(it.getAttribute("name")) == "balancecamp" }
                ?: throw IllegalArgumentException("The workbook does not contain a BALANCE - CAMP sheet.")

            val relationshipId = balanceSheet.getAttribute("r:id")
            val relationshipNodes = relationships.getElementsByTagName("Relationship")
            val target = (0 until relationshipNodes.length).asSequence()
                .map { relationshipNodes.item(it) as Element }
                .firstOrNull { it.getAttribute("Id") == relationshipId }
                ?.getAttribute("Target")
                ?.takeIf { it.isNotBlank() }
                ?: throw IllegalArgumentException("Could not locate the BALANCE - CAMP worksheet data.")
            val sheetPath = resolvePath(target)

            val shared = zip.getEntry("xl/sharedStrings.xml")?.let { entry ->
                zip.getInputStream(entry).use { input ->
                    val doc = secureFactory().newDocumentBuilder().parse(input)
                    val items = doc.getElementsByTagName("si")
                    (0 until items.length).map { index ->
                        val texts = (items.item(index) as Element).getElementsByTagName("t")
                        buildString { for (j in 0 until texts.length) append(texts.item(j).textContent) }
                    }
                }
            }.orEmpty()

            val sheet = document(sheetPath)
            val rows = sheet.getElementsByTagName("row")
            var headerRow = -1
            var itemColumn = -1
            var unitColumn = -1
            var totalColumn = -1
            val parsedRows = ArrayList<Row>()

            for (rowIndex in 0 until rows.length) {
                val cells = (rows.item(rowIndex) as Element).getElementsByTagName("c")
                val values = HashMap<Int, String>()
                for (cellIndex in 0 until cells.length) {
                    val cell = cells.item(cellIndex) as Element
                    val col = columnIndex(cell.getAttribute("r"))
                    if (col < 0) continue
                    val type = cell.getAttribute("t")
                    val value = when (type) {
                        "s" -> cell.getElementsByTagName("v").item(0)?.textContent?.toIntOrNull()?.let { shared.getOrNull(it) }.orEmpty()
                        "inlineStr" -> cell.getElementsByTagName("is").item(0)?.textContent.orEmpty()
                        else -> cell.getElementsByTagName("v").item(0)?.textContent.orEmpty()
                    }
                    values[col] = value
                }

                if (headerRow < 0) {
                    if (values.isEmpty()) continue
                    headerRow = rowIndex
                    for ((col, value) in values) when (normalize(value)) {
                        "items", "item", "material" -> itemColumn = col
                        "unit" -> unitColumn = col
                        "total" -> totalColumn = col
                    }
                    if (itemColumn < 0 || unitColumn < 0 || totalColumn < 0) {
                        throw IllegalArgumentException("BALANCE - CAMP must include items, unit, and TOTAL columns.")
                    }
                    continue
                }

                val item = values[itemColumn].orEmpty()
                if (item.isNotEmpty()) parsedRows += Row(item, values[unitColumn].orEmpty(), values[totalColumn].orEmpty())
            }
            if (headerRow < 0) throw IllegalArgumentException("The BALANCE - CAMP sheet is empty.")
            return parsedRows
        }
    }

    private fun secureFactory() = DocumentBuilderFactory.newInstance().apply {
        isNamespaceAware = false
        setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true)
        setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
    }

    private fun normalize(value: String) = value.lowercase().filter(Char::isLetterOrDigit)

    private fun columnIndex(reference: String): Int {
        var result = 0
        var letters = 0
        for (char in reference) {
            if (!char.isLetter()) break
            result = result * 26 + char.uppercaseChar().code - 'A'.code + 1
            letters++
        }
        return if (letters == 0) -1 else result - 1
    }

    private fun resolvePath(target: String): String {
        val parts = ArrayDeque<String>()
        val path = if (target.startsWith('/')) target.drop(1) else "xl/$target"
        for (part in path.split('/')) when (part) {
            "", "." -> Unit
            ".." -> if (parts.isNotEmpty()) parts.removeLast()
            else -> parts.addLast(part)
        }
        return parts.joinToString("/")
    }
}
