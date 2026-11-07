package com.campstock.inventory.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

@Database(
    entities = [
        MaterialEntity::class,
        LocationEntity::class,
        TransactionEntity::class,
        TransactionLineEntity::class,
        PhysicalStockCountEntity::class,
        SyncQueueEntity::class,
        AppSettingEntity::class,
        SupplierEntity::class
    ],
    version = 4,
    exportSchema = false
)
abstract class AppDb : RoomDatabase() {
    abstract fun dao(): AppDao

    companion object {
        @Volatile
        private var instance: AppDb? = null

        fun get(context: Context): AppDb {
            return instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDb::class.java,
                    "camp_stock.db"
                )
                    .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4)
                    .addCallback(DatabaseCallback())
                    .build()
                    .also { instance = it }
            }
        }
    }

    private class DatabaseCallback : RoomDatabase.Callback() {
        override fun onCreate(db: SupportSQLiteDatabase) {
            super.onCreate(db)
            CoroutineScope(Dispatchers.IO).launch {
                instance?.let { database ->
                    seedInitialData(database.dao())
                }
            }
        }
    }
}

// Suppliers read from the printed delivery list (11 Oct 2026). Editable in the Suppliers screen.
val DEFAULT_SUPPLIERS = listOf(
    SupplierEntity("SUP-0001", "M/S Zia Enterprise"),
    SupplierEntity("SUP-0002", "M/S Chaytara Construction"),
    SupplierEntity("SUP-0003", "Ayan Corporation"),
    SupplierEntity("SUP-0004", "S. R Enterprise"),
    SupplierEntity("SUP-0005", "M/S Azizi Enterprise")
)

// Version 1 -> 2: adds columns/tables only. No data is deleted or rewritten.
val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE materials ADD COLUMN isCustom INTEGER NOT NULL DEFAULT 0")
        for (col in listOf("drrCode", "block", "subBlock", "mrfNumber", "supplierId", "supplierName", "poNumber")) {
            db.execSQL("ALTER TABLE inventory_transactions ADD COLUMN $col TEXT NOT NULL DEFAULT ''")
        }
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `suppliers` (`supplierId` TEXT NOT NULL, `name` TEXT NOT NULL, " +
                "`phone` TEXT NOT NULL, `contactPerson` TEXT NOT NULL, `notes` TEXT NOT NULL, " +
                "`isActive` INTEGER NOT NULL, PRIMARY KEY(`supplierId`))"
        )
        for (s in DEFAULT_SUPPLIERS) {
            db.execSQL(
                "INSERT OR IGNORE INTO suppliers (supplierId, name, phone, contactPerson, notes, isActive) VALUES (?, ?, '', '', '', 1)",
                arrayOf<Any>(s.supplierId, s.name)
            )
        }
    }
}

// Version 2 -> 3: adds columns only (catalogue status, staff handover details). No data is deleted or rewritten.
val MIGRATION_2_3 = object : Migration(2, 3) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE materials ADD COLUMN isActive INTEGER NOT NULL DEFAULT 1")
        for (col in listOf("handoverFromName", "handoverFromPhone", "handoverToName", "handoverToPhone", "handoverDate")) {
            db.execSQL("ALTER TABLE inventory_transactions ADD COLUMN $col TEXT NOT NULL DEFAULT ''")
        }
    }
}

suspend fun seedInitialData(dao: AppDao) {
    dao.insertSuppliersIfAbsent(DEFAULT_SUPPLIERS)
    // Seed 9 Locations
    val locations = listOf(
        LocationEntity("LOC-CENTRAL", "Central Camp Warehouse", "CENTRAL_WAREHOUSE", "CW"),
        LocationEntity("LOC-BLOCK-A", "Block A", "BLOCK", "A"),
        LocationEntity("LOC-BLOCK-B", "Block B", "BLOCK", "B"),
        LocationEntity("LOC-BLOCK-C", "Block C", "BLOCK", "C"),
        LocationEntity("LOC-BLOCK-D", "Block D", "BLOCK", "D"),
        LocationEntity("LOC-BLOCK-E", "Block E", "BLOCK", "E"),
        LocationEntity("LOC-BLOCK-F", "Block F", "BLOCK", "F"),
        LocationEntity("LOC-BLOCK-G", "Block G", "BLOCK", "G"),
        LocationEntity("LOC-OTHER", "Other Camp Warehouse", "OTHER_WAREHOUSE", "OW")
    )
    dao.insertLocations(locations)

    // Seed 45 Materials (Verbatim codes & names; units default to NEEDS_CONFIRMATION)
    val materials = listOf(
        MaterialEntity("MAT-0001", "Bamboo Borak"),
        MaterialEntity("MAT-0002", "Bamboo Mulli"),
        MaterialEntity("MAT-0003", "Brick Chips"),
        MaterialEntity("MAT-0004", "Bricks"),
        MaterialEntity("MAT-0005", "Cement"),
        MaterialEntity("MAT-0006", "Sand"),
        MaterialEntity("MAT-0007", "Steel Reinforcing Bar 8mm"),
        MaterialEntity("MAT-0008", "Steel Reinforcing Bar 10mm"),
        MaterialEntity("MAT-0009", "Steel Reinforcing Bar 12mm"),
        MaterialEntity("MAT-0010", "Georoll (Grey) 100 x 5 m"),
        MaterialEntity("MAT-0011", "Brick Dust"),
        MaterialEntity("MAT-0012", "Dry Hydrate"),
        MaterialEntity("MAT-0013", "Nails 1 in"),
        MaterialEntity("MAT-0014", "Nails 1.5 in"),
        MaterialEntity("MAT-0015", "Nails 2 in"),
        MaterialEntity("MAT-0016", "Threaded Rod 12mm (6 ft)"),
        MaterialEntity("MAT-0017", "Washers"),
        MaterialEntity("MAT-0018", "Buttress Column 6x6x96 in"),
        MaterialEntity("MAT-0019", "Precast Beam 5x4x69 in"),
        MaterialEntity("MAT-0020", "Precast Beam 5x5x69 in"),
        MaterialEntity("MAT-0021", "Invert Slab 24x24x in", notes = "Missing final dimension in original catalogue"),
        MaterialEntity("MAT-0022", "Permeable Block 24x16x3 in"),
        MaterialEntity("MAT-0023", "PVC Pipe 4 in"),
        MaterialEntity("MAT-0024", "PVC Pipe 8 in"),
        MaterialEntity("MAT-0025", "Plain Sheet"),
        MaterialEntity("MAT-0026", "Nylon Rope 3mm"),
        MaterialEntity("MAT-0027", "Nylon Rope 6mm"),
        MaterialEntity("MAT-0028", "Steel Tie Wire #18"),
        MaterialEntity("MAT-0029", "Steel Tie Wire #22"),
        MaterialEntity("MAT-0030", "Sandbag Geotextile"),
        MaterialEntity("MAT-0031", "Sandbag Jute"),
        MaterialEntity("MAT-0032", "Arm", notes = "Meaning unconfirmed"),
        MaterialEntity("MAT-0033", "Light"),
        MaterialEntity("MAT-0034", "Nails"),
        MaterialEntity("MAT-0035", "Solar Panel"),
        MaterialEntity("MAT-0036", "Black Plastic 4ft x 50m"),
        MaterialEntity("MAT-0037", "Shelter Grade Tarpaulin (6x4)"),
        MaterialEntity("MAT-0038", "Plywood 4ft x 8ft x 1/2 in"),
        MaterialEntity("MAT-0039", "Paint 3.64 L"),
        MaterialEntity("MAT-0040", "Paint Brush 25mm"),
        MaterialEntity("MAT-0041", "Paint Brush 50mm"),
        MaterialEntity("MAT-0042", "Steel Stackers"),
        MaterialEntity("MAT-0043", "Steel Tie Wire #14"),
        MaterialEntity("MAT-0044", "Nail 3 in"),
        MaterialEntity("MAT-0045", "Treated Borak Bamboo")
    )
    dao.insertMaterials(materials)
    dao.insertMaterialsIfAbsent(com.campstock.inventory.model.AdditionalMaterials.ALL)
}


// Version 3 -> 4: add paper-register fields and damaged quantity without deleting data.
val MIGRATION_3_4 = object : Migration(3, 4) {
    override fun migrate(db: SupportSQLiteDatabase) {
        for (col in listOf("vehicleNumber", "receivedBy", "issuedBy", "acknowledgementBy")) {
            db.execSQL("ALTER TABLE inventory_transactions ADD COLUMN $col TEXT NOT NULL DEFAULT ''")
        }
        db.execSQL("ALTER TABLE transaction_lines ADD COLUMN damagedQuantity TEXT NOT NULL DEFAULT '0'")
    }
}
