import { Router } from 'express';
import { SpecialtyModel } from './specialty.model.js';

export type SpecialtyDto = {
  code: string;
  name: { ar: string; en: string };
};

export const specialtiesRouter = Router();

specialtiesRouter.get('/', async (_req, res) => {
  const specialties = await SpecialtyModel.find({ isActive: true })
    .sort({ sortOrder: 1, code: 1 })
    .lean();
  const data: SpecialtyDto[] = specialties.map(({ code, name }) => ({
    code,
    name: { ar: name.ar, en: name.en },
  }));
  res.json({ data });
});
