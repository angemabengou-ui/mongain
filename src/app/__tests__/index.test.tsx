import { render } from '@testing-library/react-native';
import React from 'react';

const mockRedirect = jest.fn((_props: any) => null);
jest.mock('expo-router', () => ({
    Redirect: (props: any) => {
        mockRedirect(props);
        return null;
    },
}));

import Index from '../index';

describe('app/index (entry redirect)', () => {
    it('redirects to the (tabs) group', async () => {
        await render(<Index />);
        expect(mockRedirect).toHaveBeenCalledWith(expect.objectContaining({ href: '/(tabs)' }));
    });
});
