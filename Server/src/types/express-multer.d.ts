// Server/src/types/express-multer.d.ts
// Purpose: teach TypeScript about multer and req.file / req.files

import "express";
import "multer";

declare global {
  namespace Express {
    interface Request {
      file?: Express.Multer.File;
      files?:
        | Express.Multer.File[]
        | { [fieldname: string]: Express.Multer.File[] };
    }
  }
}

export {};