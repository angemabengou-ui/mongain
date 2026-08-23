// Mock only the small underlying module (not all of 'react-native', which would force
// an eager require of native-only pieces like DevMenu and break under jest).
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
    __esModule: true,
    default: () => 'dark',
}));

import { renderHook } from '@testing-library/react-native';
import { useColorScheme } from '../use-color-scheme.web';

describe('useColorScheme (web)', () => {
    it('mirrors react-native\'s color scheme once hydrated, rather than staying on the pre-hydration "light" fallback', async () => {
        // The whole point of the .web variant is to avoid a server/client mismatch: it
        // returns 'light' until a `useEffect` marks the client as hydrated, then defers
        // to the real react-native color scheme. We mock that underlying scheme to
        // 'dark' — if hydration didn't kick in, the hook would incorrectly stay 'light'.
        const { result } = await renderHook(() => useColorScheme());
        expect(result.current).toBe('dark');
    });
});
