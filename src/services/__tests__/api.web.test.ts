// Covers the Platform.OS === 'web' branch of token storage (localStorage instead of
// expo-secure-store). Kept in its own file because mocking react-native's Platform
// module affects every import in the file — the main api.test.ts exercises the
// native (SecureStore) branch, which is Platform.OS's default under jest-expo.
jest.mock('react-native/Libraries/Utilities/Platform', () => ({
    __esModule: true,
    default: {
        OS: 'web',
        select: (obj: any) => obj.web ?? obj.default,
    },
}));

jest.mock('expo-secure-store', () => ({
    setItemAsync: jest.fn(),
    getItemAsync: jest.fn(),
    deleteItemAsync: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { deleteToken, getToken, saveToken } from '../api';

describe('api service — token storage (web)', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        (global as any).localStorage = {
            setItem: jest.fn(),
            getItem: jest.fn(),
            removeItem: jest.fn(),
        };
    });

    it('saveToken writes to localStorage instead of SecureStore', async () => {
        await saveToken('web-tok');
        expect((global as any).localStorage.setItem).toHaveBeenCalledWith('mongain_token', 'web-tok');
        expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    });

    it('getToken reads from localStorage instead of SecureStore', async () => {
        (global as any).localStorage.getItem.mockReturnValueOnce('web-tok-2');
        const token = await getToken();
        expect(token).toBe('web-tok-2');
        expect((global as any).localStorage.getItem).toHaveBeenCalledWith('mongain_token');
        expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
    });

    it('deleteToken removes from localStorage instead of SecureStore', async () => {
        await deleteToken();
        expect((global as any).localStorage.removeItem).toHaveBeenCalledWith('mongain_token');
        expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    });
});
