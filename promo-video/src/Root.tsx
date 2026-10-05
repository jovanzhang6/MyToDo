import { Composition, staticFile } from "remotion";
import { Promo } from "./Promo";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Promo"
      component={Promo}
      durationInFrames={730}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{}}
    />
  );
};
