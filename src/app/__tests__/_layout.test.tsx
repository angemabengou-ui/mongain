import { render } from '@testing-library/react-native';
import React from 'react';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native-get-random-values', () => ({}));

jest.mock('expo-splash-screen', () => ({
    preventAutoHideAsync: jest.fn(),
    hideAsync: jest.fn(),
}));

const mockReplace = jest.fn();
const mockUseSegments = jest.fn(() => []);
const mockUseRootNavigationState = jest.fn(() => ({ key: 'root' }));
const mockScreenCalls: any[] = [];
jest.mock('expo-router', () => {
    const StackMock: any = ({ children }: any) => children;
    StackMock.Screen = (props: any) => {
        mockScreenCalls.push(props);
        return null;
    };
    return {
        Stack: StackMock,
        useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
        useSegments: () => mockUseSegments(),
        useRootNavigationState: () => mockUseRootNavigationState(),
    };
});

const mockUseAuth = jest.fn();
jest.mock('../../context/AuthContext', () => ({
    AuthProvider: ({ children }: any) => children,
    useAuth: () => mockUseAuth(),
}));

const mockSecurityWrapperCalls: any[] = [];
jest.mock('../../components/SecurityWrapper', () => ({
    SecurityWrapper: ({ children }: any) => {
        mockSecurityWrapperCalls.push(true);
        return children;
    },
}));

import RootLayout from '../_layout';

describe('app/_layout (RootLayoutNav)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockScreenCalls.length = 0;
        mockSecurityWrapperCalls.length = 0;
        mockUseSegments.mockReturnValue([]);
        mockUseRootNavigationState.mockReturnValue({ key: 'root' } as any);
    });

    it('redirects to /auth/login when there is no token and not already in the auth group', async () => {
        mockUseAuth.mockReturnValue({ token: null, isLoading: false });

        await render(<RootLayout />);

        expect(mockReplace).toHaveBeenCalledWith('/auth/login');
    });

    it('redirects to / when a token exists but the user is still in the auth group', async () => {
        mockUseAuth.mockReturnValue({ token: 'abc123', isLoading: false });
        mockUseSegments.mockReturnValue(['auth']);

        await render(<RootLayout />);

        expect(mockReplace).toHaveBeenCalledWith('/');
    });

    it('does not redirect while auth is still loading', async () => {
        mockUseAuth.mockReturnValue({ token: null, isLoading: true });

        await render(<RootLayout />);

        expect(mockReplace).not.toHaveBeenCalled();
    });

    it('registers the expected top-level Stack screens and mounts the SecurityWrapper', async () => {
        mockUseAuth.mockReturnValue({ token: 'abc123', isLoading: false });

        await render(<RootLayout />);

        const names = mockScreenCalls.map((c) => c.name);
        expect(names).toEqual(expect.arrayContaining(['(tabs)', 'transfer', 'transfer-confirm', 'auth/login', 'auth/register']));
        expect(mockSecurityWrapperCalls.length).toBeGreaterThan(0);
    });
});
