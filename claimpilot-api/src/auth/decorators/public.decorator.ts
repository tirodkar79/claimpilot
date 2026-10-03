import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../auth.constants';

/** Skips API key authentication for a route or controller. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
