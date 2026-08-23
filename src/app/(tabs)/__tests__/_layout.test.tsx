import { render } from '@testing-library/react-native';
import React from 'react';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const mockScreenCalls: any[] = [];
jest.mock('expo-router', () => {
    const TabsMock: any = ({ children }: any) => children;
    TabsMock.Screen = (props: any) => {
        mockScreenCalls.push(props);
        return null;
    };
    return { Tabs: TabsMock };
});

import TabLayout from '../_layout';

describe('(tabs)/_layout', () => {
    beforeEach(() => {
        mockScreenCalls.length = 0;
    });

    it('renders the three main tab screens with the expected titles', async () => {
        await render(<TabLayout />);

        expect(mockScreenCalls).toHaveLength(3);
        const byName = Object.fromEntries(mockScreenCalls.map((c) => [c.name, c.options]));

        expect(byName.index.title).toBe('Accueil');
        expect(byName.history.title).toBe('Historique');
        expect(byName.profile.title).toBe('Profil');
    });
});
