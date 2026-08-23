import { renderHook } from '@testing-library/react-native';
import { useColorScheme } from '../use-color-scheme';

describe('useColorScheme (native)', () => {
    it('re-exports react-native\'s useColorScheme and returns a value', async () => {
        const { result } = await renderHook(() => useColorScheme());
        // jest-expo's native test environment defaults to a light/undefined scheme;
        // we only assert it resolves to one of the documented values.
        expect(['light', 'dark', null, undefined]).toContain(result.current);
    });
});
