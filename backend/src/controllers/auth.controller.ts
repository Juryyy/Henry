import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import speakeasy from 'speakeasy';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';


