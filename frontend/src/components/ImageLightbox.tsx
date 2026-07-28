interface Props {
  src: string;
  onClose: () => void;
}

/** Ventana con la imagen ampliada; cualquier click (fondo o imagen) la cierra. */
export function ImageLightbox({ src, onClose }: Props) {
  return (
    <div className="modal-overlay image-lightbox-overlay" onClick={onClose}>
      <img src={src} alt="" className="image-lightbox-img" />
    </div>
  );
}
