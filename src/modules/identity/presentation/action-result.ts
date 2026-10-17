import type { ProfileDto } from '../domain/registration';
export type IdentityResult = {
  status:
    | 'success'
    | 'validation'
    | 'unauthorized'
    | 'conflict'
    | 'unavailable'
    | 'error';
  message?: string;
  fieldErrors?: Record<string, string[]>;
  profile?: ProfileDto;
};
