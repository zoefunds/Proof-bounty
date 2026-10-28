# ProofBounty web application

Next.js 16 and React 19 frontend deployed at
<https://proof-bounty.vercel.app>.

The browser wallet signs GenLayer adjudication transactions and Base Sepolia
USDC transactions. The frontend never contains relay, decision-signer, or
funding-attestor private keys.

## Development

```bash
cp .env.example .env.local
npm ci
npm run dev
```

```bash
npm run lint
npx tsc --noEmit
npm run build
```

See [../../docs/ENVIRONMENT.md](../../docs/ENVIRONMENT.md) for production
addresses and public configuration, and
[../../docs/CROSS_CHAIN_SECURITY.md](../../docs/CROSS_CHAIN_SECURITY.md) for
funding and recovery behavior.
