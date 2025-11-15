# Pinball Stats Tracker

A modern, mobile-friendly web application for tracking pinball tournament performance and statistics. Built with Next.js, Tailwind CSS, and Supabase.

## Features

- 🎮 **Machine Gallery**: Browse 400+ pinball machines with photos
- 🏆 **Tournament Tracking**: Record and analyze tournament results
- 👤 **User Profiles**: Personal statistics and achievements
- 📊 **Performance Analytics**: Track progress over time
- 👥 **Team Support**: Team affiliations and rankings (The Wrecking Crew)
- 📱 **Mobile-First Design**: Fully responsive interface
- 🔐 **Authentication**: Secure login with email or Google

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS + shadcn/ui
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **Data Tables**: TanStack Table
- **Charts**: Recharts
- **Deployment**: Vercel

## Getting Started

### Prerequisites

- Node.js 18+ installed
- Supabase account (free tier works)
- Git

### Installation

1. **Clone the repository**
   ```bash
   git clone [your-repo-url]
   cd pinball-stats
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up Supabase**
   - Create a new project at [supabase.com](https://supabase.com)
   - Go to Settings > API
   - Copy your project URL and anon key

4. **Configure environment variables**
   ```bash
   cp .env.local.example .env.local
   ```
   Edit `.env.local` and add your Supabase credentials:
   ```
   NEXT_PUBLIC_SUPABASE_URL=your_project_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ```

5. **Set up the database**
   - Go to Supabase SQL Editor
   - Run the schema from `supabase/schema.sql`

6. **Add game photos**
   - Place your 400 JPG files in `/public/games/`
   - Name them consistently (e.g., `attack-from-mars.jpg`)

7. **Run the development server**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000)

## Project Structure

```
pinball-stats/
├── app/                  # Next.js app directory
│   ├── (auth)/          # Authentication pages
│   ├── login/           # Login page
│   ├── register/        # Registration page
│   ├── profile/         # User profile
│   ├── machines/        # Machine gallery
│   └── tournaments/     # Tournament data
├── components/          # React components
│   ├── ui/             # shadcn/ui components
│   └── main-nav.tsx    # Navigation component
├── lib/                 # Utility functions
│   ├── supabase.ts     # Supabase client
│   └── utils.ts        # Helper functions
├── data/               # JSON data files
├── public/             
│   └── games/          # Machine photos (400 JPGs)
└── supabase/           # Database schema
```

## Data Management

### Public Data (JSON Files)
- Tournament results
- Machine information
- Venue data

Store in `/data` folder and import as needed.

### User Data (Supabase)
- User profiles
- Personal statistics
- Favorite machines
- Private notes

Managed through Supabase with Row Level Security.

## Migrating from Streamlit

1. **Export your current data** from the Streamlit app
2. **Convert Python logic** to JavaScript in `/lib`
3. **Import tournament JSON** to `/data`
4. **Upload machine photos** to `/public/games`

## Deployment

### Deploy to Vercel

1. Push your code to GitHub
2. Import project to Vercel
3. Add environment variables
4. Deploy

### Environment Variables for Production

```
NEXT_PUBLIC_SUPABASE_URL=your_production_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_production_key
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

## Development Workflow

1. **Start development server**: `npm run dev`
2. **Build for production**: `npm run build`
3. **Run production build**: `npm run start`
4. **Lint code**: `npm run lint`

## Features Roadmap

- [x] User authentication
- [x] Profile management
- [x] Machine gallery
- [ ] Tournament data import
- [ ] Advanced statistics
- [ ] Team features
- [ ] Social features
- [ ] PWA support
- [ ] Offline mode

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a pull request

## License

MIT

## Support

For issues or questions, please open an issue on GitHub.
