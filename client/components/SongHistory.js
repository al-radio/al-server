import { useEffect, useState } from "react";
import {
  Window,
  WindowHeader,
  WindowContent,
  Table,
  TableHead,
  TableHeadCell,
  TableBody,
  TableRow,
  TableDataCell,
  Avatar,
} from "react95";
import { fetchSongHistory } from "../services/api";
import GetSong from "./GetSong";

const SongHistory = () => {
  const [songHistory, setSongHistory] = useState([]);
  const [selectedSong, setSelectedSong] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    const getSongHistory = async () => {
      try {
        const historyData = await fetchSongHistory();
        setSongHistory(historyData);
      } catch (error) {
        console.error("Error fetching song history:", error);
      }
    };

    getSongHistory();
    const intervalId = setInterval(getSongHistory, 10000);
    return () => clearInterval(intervalId); // Clean up interval on unmount
  }, []);

  const handleRowClick = (song) => {
    setSelectedSong(song);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedSong(null);
  };

  return (
    <>
      <Window>
        <WindowHeader>History</WindowHeader>
        <WindowContent>
          <Table>
            <TableHead>
              <TableHeadCell></TableHeadCell>
              <TableHeadCell>Title</TableHeadCell>
              <TableHeadCell>Artist</TableHeadCell>
            </TableHead>
            <TableBody>
              {songHistory.map((song, index) => (
                <TableRow key={index} onClick={() => handleRowClick(song)}>
                  <TableDataCell>
                    <Avatar square size={50} src={song.artUrl} />
                  </TableDataCell>
                  <TableDataCell>{song.title}</TableDataCell>
                  <TableDataCell>{song.artist}</TableDataCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WindowContent>
      </Window>

      {selectedSong && (
        <GetSong
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          urlForPlatform={selectedSong.urlForPlatform}
        />
      )}
    </>
  );
};

export default SongHistory;
