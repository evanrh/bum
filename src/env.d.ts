/// <reference types="astro/client" />
import type { User } from './db/schema.ts';

declare global {
  namespace App {
    interface Locals {
      user: User | null;
    }
  }
}
