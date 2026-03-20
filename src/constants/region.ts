import { MAP_SIZE } from './spatial';

export type RegionCode = 'N' | 'G' | 'P' | 'M' | 'C' | 'F' | 'H' | 'S' | 'D' | 'I' | '~';

export const REGION_NAMES: Readonly<Record<RegionCode, string>> = {
  N: '朔北冻原', G: '苍茫草海', P: '西嶂高原', M: '天断山脉',
  C: '河洛中野', F: '东陵林海', H: '赤岚丘陵', S: '南淮泽国',
  D: '裂潮海岸', I: '潮生群岛', '~': '外海',
};

const REGION_MAP_RAW = [
  'NNNN NNNN NNNN GGGG GGGG FFFF FF~~ ~~~~',
  'NNNN NNNN NNNG GGGG GGFF FFFF F~~~ ~~~~',
  'NNNN NNNN NNGG GGGG GGFF FFFF FD~~ ~~~~',
  'NNNN NNNN GGGG GGGG GFFF FFFF FDDD ~~~~',
  'NNNN NNNG GGGG GGGG MMMF FFFF FDDD ~~~~',
  'NNNN GGGG GGGG GGGM MMMF FFFF FDDD ~~~~',
  'NNNG GGGG GGGG GGMM MMMF FFFF DDDD ~~~~',
  'GGGG GGGG GGGM MMMM MMMF FFFD DDDD ~~~~',
  'PPPP PPPP PMMM MMMM CCCC CCFF FDDD DDDD',
  'PPPP PPPP MMMM MMMC CCCC CCFF FDDD DDDD',
  'PPPP PPPM MMMM MMCC CCCC CFFF FDDD DDDD',
  'PPPP PPPM MMMM MCCC CCCC CFFF FDDD DDDD',
  'PPPP PPPH MMMM CCCC CCCC CCFF FDDD DDDD',
  'PPPP PHHH MMMC CCCC CCCC CCFF FDDD DDDD',
  'PPPH HHHH MMMC CCCC CCCC CCFF FDDD DDDD',
  'PPHH HHHH MMCC CCCC CCCC CSSF FDDD DIII',
  'PPHH HHHH MMMC CCCC CCCS SSSF DDDD DIII',
  'PHHH HHHH MMCC CCCC CCSS SSSS DDDD DIII',
  'HHHH HHHH MMCC CCCC CSSS SSSS DDDD DIII',
  'HHHH HHHH MCCC CCCC CSSS SSSS DDDD DIII',
  'HHHH HHHH HHHS SSSS SSSS SSSD DDDI IIII',
  'HHHH HHHH HHSS SSSS SSSS SSSD DDII IIII',
  'HHHH HHHH HSSS SSSS SSSS SDDD DDII IIII',
  'HHHH HHHH HSSS SSSS SSSD DDDD DIII IIII',
  'HHHH HHSS SSSS SSSS SDDD DIII IIII IIII',
  'HHHH HSSS SSSS SSSS DDDD DIII IIII II~~',
  'HHHH HSSS SSSS SSSD DDDD IIII IIII I~~~',
  'HHSS SSSS SSSS DDDD DDDD IIII IIII ~~~~',
  '~~~~ ~~~~ ~~~~ ~~~~ IIII IIII I~~~ ~~~~',
  '~~~~ ~~~~ ~~~~ ~~~~ ~III IIII ~~~~ ~~~~',
  '~~~~ ~~~~ ~~~~ ~~~~ ~~II III~ ~~~~ ~~~~',
  '~~~~ ~~~~ ~~~~ ~~~~ ~~~~ ~~~~ ~~~~ ~~~~',
] as const;

const REGION_GRID: readonly RegionCode[] = REGION_MAP_RAW.flatMap(
  row => [...row.replace(/ /g, '')] as RegionCode[],
);

export function getRegionCode(x: number, y: number): RegionCode {
  return REGION_GRID[y * MAP_SIZE + x];
}

export function getRegionName(x: number, y: number): string {
  return REGION_NAMES[getRegionCode(x, y)];
}
