import { generateReference } from '../reference';

describe('generateReference', () => {
    it('devrait générer une référence commençant par le préfixe fourni', () => {
        const ref = generateReference('CIN');
        expect(ref.startsWith('CIN-')).toBe(true);
    });

    it('devrait générer une référence avec 12 caractères hexadécimaux majuscules après le préfixe', () => {
        const ref = generateReference('COT');
        const suffix = ref.slice('COT-'.length);
        expect(suffix).toMatch(/^[0-9A-F]{12}$/);
    });

    it('devrait générer des références différentes à chaque appel', () => {
        const ref1 = generateReference('TEST');
        const ref2 = generateReference('TEST');
        expect(ref1).not.toBe(ref2);
    });

    it('devrait fonctionner avec un préfixe composé', () => {
        const ref = generateReference('SEEG-12345');
        expect(ref.startsWith('SEEG-12345-')).toBe(true);
    });
});
