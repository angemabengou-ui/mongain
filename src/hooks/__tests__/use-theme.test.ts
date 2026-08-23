import { renderHook } from '@testing-library/react-native';
import { useTheme } from '../use-theme';

describe('useTheme', () => {
    it('retourne les couleurs du thème par défaut', async () => {
        const { result } = await renderHook(() => useTheme());
        expect(result.current).toBeDefined();
        expect(result.current.text).toBeDefined();
    });
});
