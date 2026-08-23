import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const mockPush = jest.fn();
jest.mock('expo-router', () => {
    const react = require('react');
    return {
        useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
        useFocusEffect: (cb: any) => react.useEffect(() => { cb(); }, []),
    };
});

const mockPrintToFileAsync = jest.fn();
jest.mock('expo-print', () => ({
    printToFileAsync: (...args: any[]) => mockPrintToFileAsync(...args),
}));

const mockIsAvailableAsync = jest.fn();
const mockShareAsync = jest.fn();
jest.mock('expo-sharing', () => ({
    isAvailableAsync: (...args: any[]) => mockIsAvailableAsync(...args),
    shareAsync: (...args: any[]) => mockShareAsync(...args),
}));

const mockApiGetTransactions = jest.fn();
jest.mock('../../../services/api', () => ({
    apiGetTransactions: (...args: any[]) => mockApiGetTransactions(...args),
}));

import HistoryScreen from '../history';

const transactions = [
    { id: 't1', type: 'incoming', amount: 2000, currency: 'FCFA', status: 'COMPLETED', reference: 'REF1', counterpart: 'Alice', counterpartPhone: '077111111', createdAt: '2026-01-01T10:00:00.000Z' },
    { id: 't2', type: 'outgoing', amount: 500, currency: 'FCFA', status: 'PENDING', reference: 'REF2', counterpart: 'Bob', counterpartPhone: '077222222', createdAt: '2026-01-02T10:00:00.000Z' },
];

describe('(tabs)/history (HistoryScreen)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders the empty state when there are no transactions', async () => {
        mockApiGetTransactions.mockResolvedValue([]);

        await render(<HistoryScreen />);

        expect(await screen.findByText("Aucune transaction pour l'instant.")).toBeTruthy();
    });

    it('renders the populated list with a pending status pill', async () => {
        mockApiGetTransactions.mockResolvedValue(transactions);

        await render(<HistoryScreen />);

        expect(await screen.findByText('Alice')).toBeTruthy();
        expect(screen.getByText('Bob')).toBeTruthy();
        expect(screen.getByText('En attente')).toBeTruthy();
    });

    it('filters to outgoing-only transactions when the "Envoyé" pill is pressed', async () => {
        mockApiGetTransactions.mockResolvedValue(transactions);

        await render(<HistoryScreen />);
        await screen.findByText('Alice');

        fireEvent.press(screen.getByText('Envoyé'));

        expect(await screen.findByText('Bob')).toBeTruthy();
        expect(screen.queryByText('Alice')).toBeNull();
    });

    it('navigates to the receipt screen when a transaction row is pressed', async () => {
        mockApiGetTransactions.mockResolvedValue(transactions);

        await render(<HistoryScreen />);
        await screen.findByText('Alice');

        fireEvent.press(screen.getByText('Alice'));

        expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({
            pathname: '/receipt',
            params: expect.objectContaining({ id: 't1', counterpart: 'Alice' }),
        }));
    });

    it('generates and shares a PDF when the download button is pressed', async () => {
        mockApiGetTransactions.mockResolvedValue(transactions);
        mockPrintToFileAsync.mockResolvedValue({ uri: 'file://receipt.pdf' });
        mockIsAvailableAsync.mockResolvedValue(true);
        mockShareAsync.mockResolvedValue(undefined);

        await render(<HistoryScreen />);
        await screen.findByText('Alice');

        fireEvent.press(screen.getByText('download'));

        expect(await screen.findByText('download')).toBeTruthy();
        expect(mockPrintToFileAsync).toHaveBeenCalled();
        expect(mockShareAsync).toHaveBeenCalledWith('file://receipt.pdf');
    });

    it('logs an error and does not share when PDF generation fails', async () => {
        mockApiGetTransactions.mockResolvedValue(transactions);
        mockPrintToFileAsync.mockRejectedValue(new Error('print failed'));
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => { });

        await render(<HistoryScreen />);
        await screen.findByText('Alice');

        fireEvent.press(screen.getByText('download'));
        await Promise.resolve();
        await Promise.resolve();

        expect(mockShareAsync).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });
});
