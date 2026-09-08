import { rpc } from '@stellar/stellar-sdk';
type T = Awaited<ReturnType<rpc.Server["getNetwork"]>>;
// just to see the properties in T
