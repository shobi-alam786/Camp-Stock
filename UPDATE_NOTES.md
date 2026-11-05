# Update notes — 5 November 2026

- Removed the material-name list/column from Transaction History on Windows and Android. Transaction quantity, type, date, reference, staff, and sync information remain.
- Current Stock now hides materials whose calculated current balance is zero or has no value on both platforms. Positive and negative non-zero balances remain visible.
- Removed CSV export/share options from Windows reports, Windows IOM Stock Records, Android reports, and Android IOM Stock Records. Excel export options remain available.
- Removed the now-unused IOM CSV serialization helpers and CSV-only report string builders/tests where they were no longer required.
- Preserved stock calculation, transaction records, Room/IndexedDB databases, Kobo sync logic, and Excel workbook generation.
- Build verification could not be completed in this environment: Gradle distribution download was blocked by unavailable network access, and frontend dependencies (including `vite/client`) are not installed. Please run the repository GitHub Actions workflows to complete both builds.
