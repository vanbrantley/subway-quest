// mobile/contexts/DatabaseContext.tsx
// Opens SQLite once, at the root, instead of each screen managing its own
// connection. Reads db/schema.sql at runtime via expo-asset rather than
// keeping a second hand-copied DDL string — schema.sql stays the one
// source of truth schema_tests.py also runs against, so the two can't drift.
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import * as SQLite from 'expo-sqlite';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import schemaAsset from '../db/schema.sql';

const DB_NAME = 'subwayquest.db';
const DatabaseContext = createContext<SQLite.SQLiteDatabase | null>(null);

async function initSchema(db: SQLite.SQLiteDatabase) {
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    if ((row?.user_version ?? 0) > 0) return; // already initialized

    // const asset = Asset.fromModule(require('../db/schema.sql'));
    const asset = Asset.fromModule(schemaAsset);
    await asset.downloadAsync();
    const schemaSql = await new File(asset.localUri!).text();
    await db.execAsync(schemaSql);
    await db.execAsync('PRAGMA user_version = 1');
}

export function DatabaseProvider({ children, onReady }: { children: ReactNode; onReady?: () => void }) {
    const [db, setDb] = useState<SQLite.SQLiteDatabase | null>(null);

    useEffect(() => {
        let mounted = true;
        (async () => {
            const database = await SQLite.openDatabaseAsync(DB_NAME);
            await initSchema(database);
            if (mounted) { setDb(database); onReady?.(); }
        })();
        return () => { mounted = false; };
    }, [onReady]);

    if (!db) return null; // root layout's splash logic should key off this too, alongside auth
    return <DatabaseContext.Provider value={db}>{children}</DatabaseContext.Provider>;
}

export function useDb(): SQLite.SQLiteDatabase {
    const db = useContext(DatabaseContext);
    if (!db) throw new Error('useDb() called outside DatabaseProvider, or before it finished opening');
    return db;
}