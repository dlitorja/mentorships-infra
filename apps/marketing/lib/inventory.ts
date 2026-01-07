const WEB_APP_URL = process.env.WEB_APP_URL || "http://localhost:3001";

export interface InstructorInventory {
  oneOnOneInventory: number;
  groupInventory: number;
}

export async function getInstructorInventory(
  slug: string
): Promise<InstructorInventory | null> {
  try {
    const response = await fetch(
      `${WEB_APP_URL}/api/instructor/${slug}/inventory`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        next: { revalidate: 0 },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Failed to fetch inventory: ${response.statusText}`);
    }

    return response.json();
  } catch (error) {
    console.error("Error fetching instructor inventory:", error);
    return null;
  }
}

export async function updateInstructorInventory(
  slug: string,
  updates: Partial<InstructorInventory>
): Promise<InstructorInventory | null> {
  try {
    const response = await fetch(
      `${WEB_APP_URL}/api/instructor/${slug}/inventory`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to update inventory: ${response.statusText}`);
    }

    return response.json();
  } catch (error) {
    console.error("Error updating instructor inventory:", error);
    return null;
  }
}
