import TonConnect from '@tonconnect/sdk';
import { TonConnectStorage } from './storage';
import * as process from 'process';

const DEBUG = process.env.DEBUG_MODE === 'true';

type StoredConnectorData = {
    connector: TonConnect;
    timeout: ReturnType<typeof setTimeout>;
    onConnectorExpired: ((connector: TonConnect) => void)[];
};

const connectors = new Map<number, StoredConnectorData>();

/**
 * Retry function for handling network operations that might fail
 */
async function withRetry<T>(operation: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        if (retries <= 0) throw error;
        if (DEBUG) {
            console.log(`[CONNECTOR] Operation failed, retrying in ${delay}ms... (${retries} retries left)`);
            console.log(`[CONNECTOR] Error:`, error);
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        return withRetry(operation, retries - 1, delay * 1.5);
    }
}

export function getConnector(
    chatId: number,
    onConnectorExpired?: (connector: TonConnect) => void
): TonConnect {
    if (DEBUG) {
        console.log(`[CONNECTOR] getConnector for chatId: ${chatId}`);
    }
    let storedItem: StoredConnectorData;
    if (connectors.has(chatId)) {
        storedItem = connectors.get(chatId)!;
        clearTimeout(storedItem.timeout);
    } else {
        if (DEBUG) {
            console.log(`[CONNECTOR] Creating new connector for chatId: ${chatId}`);
        }
        storedItem = {
            connector: new TonConnect({
                manifestUrl: process.env.MANIFEST_URL,
                storage: new TonConnectStorage(chatId)
            }),
            onConnectorExpired: []
        } as unknown as StoredConnectorData;
    }

    if (onConnectorExpired) {
        storedItem.onConnectorExpired.push(onConnectorExpired);
    }

    storedItem.timeout = setTimeout(() => {
        if (connectors.has(chatId)) {
            const storedItem = connectors.get(chatId)!;
            storedItem.connector.pauseConnection();
            storedItem.onConnectorExpired.forEach(callback => callback(storedItem.connector));
            connectors.delete(chatId);
        }
    }, Number(process.env.CONNECTOR_TTL_MS));

    connectors.set(chatId, storedItem);
    if (DEBUG) {
        console.log(`[CONNECTOR] Returning connector for chatId: ${chatId}, connected: ${storedItem.connector.connected}`);
    }
    return storedItem.connector;
}
