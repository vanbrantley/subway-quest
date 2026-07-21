// mobile/constants/lineIcons.tsx
import Route1 from '../assets/subway-icons/1.svg';
import Route2 from '../assets/subway-icons/2.svg';
import Route3 from '../assets/subway-icons/3.svg';
import Route4 from '../assets/subway-icons/4.svg';
import Route5 from '../assets/subway-icons/5.svg';
import Route6 from '../assets/subway-icons/6.svg';
import Route7 from '../assets/subway-icons/7.svg';
import RouteA from '../assets/subway-icons/A.svg';
import RouteB from '../assets/subway-icons/B.svg';
import RouteC from '../assets/subway-icons/C.svg';
import RouteD from '../assets/subway-icons/D.svg';
import RouteE from '../assets/subway-icons/E.svg';
import RouteF from '../assets/subway-icons/F.svg';
import RouteG from '../assets/subway-icons/G.svg';
import RouteJ from '../assets/subway-icons/J.svg';
import RouteL from '../assets/subway-icons/L.svg';
import RouteM from '../assets/subway-icons/M.svg';
import RouteN from '../assets/subway-icons/N.svg';
import RouteQ from '../assets/subway-icons/Q.svg';
import RouteR from '../assets/subway-icons/R.svg';
import RouteS from '../assets/subway-icons/S.svg';
import RouteSI from '../assets/subway-icons/SI.svg';
import RouteW from '../assets/subway-icons/W.svg';
import RouteZ from '../assets/subway-icons/Z.svg';

export const LINE_ICONS: Record<string, React.FC<{ width?: number; height?: number }>> = {
    '1': Route1, '2': Route2, '3': Route3, '4': Route4, '5': Route5,
    '6': Route6, '7': Route7,
    A: RouteA, B: RouteB, C: RouteC, D: RouteD, E: RouteE, F: RouteF,
    G: RouteG, J: RouteJ, L: RouteL, M: RouteM, N: RouteN, Q: RouteQ,
    R: RouteR, S: RouteS, SI: RouteSI, W: RouteW, Z: RouteZ,
};