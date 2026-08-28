import { Request, Response } from 'express';
import { adminIpAllowlistMiddleware, normalizeIp } from '../adminIpAllowlist';
import { getSystemSettings } from '../../routes/settings';

jest.mock('../../routes/settings', () => ({
    getSystemSettings: jest.fn(),
}));

describe('normalizeIp', () => {
    it('retire le préfixe IPv4-mappée-IPv6', () => {
        expect(normalizeIp('::ffff:203.0.113.5')).toBe('203.0.113.5');
    });

    it('laisse une IPv4 classique inchangée', () => {
        expect(normalizeIp('203.0.113.5')).toBe('203.0.113.5');
    });
});

describe('adminIpAllowlistMiddleware', () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let next: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        req = { ip: '203.0.113.5' };
        res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        next = jest.fn();
    });

    it('laisse passer sans vérifier quoi que ce soit quand la restriction est désactivée', async () => {
        (getSystemSettings as jest.Mock).mockResolvedValue({ adminIpAllowlistEnabled: false, adminIpAllowlist: [] });

        await adminIpAllowlistMiddleware(req as Request, res as Response, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it("laisse passer une IP présente dans la liste (activée)", async () => {
        (getSystemSettings as jest.Mock).mockResolvedValue({ adminIpAllowlistEnabled: true, adminIpAllowlist: ['203.0.113.5'] });

        await adminIpAllowlistMiddleware(req as Request, res as Response, next);

        expect(next).toHaveBeenCalled();
    });

    it("bloque avec 403 une IP absente de la liste (activée)", async () => {
        (getSystemSettings as jest.Mock).mockResolvedValue({ adminIpAllowlistEnabled: true, adminIpAllowlist: ['198.51.100.1'] });

        await adminIpAllowlistMiddleware(req as Request, res as Response, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it("compare après normalisation de la forme IPv4-mappée-IPv6 des deux côtés", async () => {
        const mappedReq = { ip: '::ffff:203.0.113.5' } as Partial<Request>;
        (getSystemSettings as jest.Mock).mockResolvedValue({ adminIpAllowlistEnabled: true, adminIpAllowlist: ['203.0.113.5'] });

        await adminIpAllowlistMiddleware(mappedReq as Request, res as Response, next);

        expect(next).toHaveBeenCalled();
    });

    it('refuse par défaut (503) plutôt que de laisser passer si les paramètres sont illisibles', async () => {
        (getSystemSettings as jest.Mock).mockRejectedValue(new Error('DB down'));

        await adminIpAllowlistMiddleware(req as Request, res as Response, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(503);
    });
});
