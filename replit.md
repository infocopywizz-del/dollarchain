# DollarChain - Invoice Generator

## Overview
Credit-based invoice generator app for DollarChain.store. This is a React + Vite frontend application with Supabase integration for backend data storage.

**Current State**: Frontend application is set up and running successfully in development mode. The app includes UI components for checking client credits and managing invoices.

## Project Status
- **Last Updated**: October 28, 2025
- **Status**: Development environment configured and running
- **Framework**: React 18 + Vite 5
- **Backend**: Supabase (requires environment variables)
- **API Routes**: Vercel-style serverless functions in `/api` folder

## Project Architecture

### Frontend (React + Vite)
- Entry point: `index.html` → `src/main.jsx`
- Main app: `src/App.jsx`
- Components: `src/components/CreditsButton.jsx`
- Supabase client: `src/lib/supabase.js`
- Dev server: Port 5000 (configured for Replit)

### API Routes (Serverless Functions)
Located in `/api` folder:
- `hello.js` - Health check endpoint
- `credits.js` - Get client credits from Supabase
- `paystack-webhook.js` - Webhook handler for Paystack payments

**Note**: These API routes use Vercel-style handlers and require either:
1. Deployment to Vercel for automatic serverless function support, or
2. A custom backend server (Express, etc.) to handle the routes locally

### Dependencies
- **React**: UI framework
- **Vite**: Build tool and dev server
- **@supabase/supabase-js**: Database client
- **@vitejs/plugin-react**: Vite plugin for React

## Environment Variables Needed
The following environment variables should be set in Replit Secrets:
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key (for frontend)
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key (for API routes)

## Development Workflow
1. **Dev server**: `npm run dev` - Runs Vite dev server on port 5000
2. **Build**: `npm run build` - Creates production build
3. **Preview**: `npm run preview` - Preview production build

## Recent Changes
- **Oct 28, 2025**: 
  - Fixed package.json filename (removed leading spaces)
  - Added @vitejs/plugin-react dependency
  - Configured Vite to use port 5000 with host 0.0.0.0
  - Added allowedHosts: true for Replit iframe proxy support
  - Created .gitignore for Node.js projects
  - Set up Dev Server workflow
  - Configured deployment settings for autoscale

## Repository Information
- **Origin**: https://github.com/infocopywizz-del/dollarchain
- **Branch**: main
